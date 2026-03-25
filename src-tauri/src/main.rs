#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use rodio::Source;

// ── Symphonia-based streaming decoder ─────────────────────────────────────────
// rodio 0.20's Decoder::new() panics on WebM containers (unreachable!() on
// SeekError).  This custom Source uses symphonia directly.  A background thread
// decodes packets and pushes samples into a lock-free ring buffer so playback
// starts almost instantly while decoding continues in the background.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Lock-free SPSC ring buffer for f32 samples.
struct SampleRing {
    buf: Vec<std::sync::atomic::AtomicU32>,  // f32 stored as u32 bits
    write_pos: AtomicUsize,  // total samples written (monotonic)
    read_pos:  AtomicUsize,  // total samples read    (monotonic)
    done:      AtomicBool,   // decoder thread finished
}

impl SampleRing {
    fn new(cap: usize) -> Self {
        let mut buf = Vec::with_capacity(cap);
        for _ in 0..cap {
            buf.push(std::sync::atomic::AtomicU32::new(0));
        }
        SampleRing {
            buf,
            write_pos: AtomicUsize::new(0),
            read_pos:  AtomicUsize::new(0),
            done:      AtomicBool::new(false),
        }
    }

    fn capacity(&self) -> usize { self.buf.len() }

    fn push(&self, sample: f32) -> bool {
        let wp = self.write_pos.load(Ordering::Relaxed);
        let rp = self.read_pos.load(Ordering::Acquire);
        if wp - rp >= self.buf.len() { return false; } // full
        self.buf[wp % self.buf.len()].store(sample.to_bits(), Ordering::Relaxed);
        self.write_pos.store(wp + 1, Ordering::Release);
        true
    }

    fn pop(&self) -> Option<f32> {
        let rp = self.read_pos.load(Ordering::Relaxed);
        let wp = self.write_pos.load(Ordering::Acquire);
        if rp >= wp { return None; } // empty
        let val = f32::from_bits(self.buf[rp % self.buf.len()].load(Ordering::Relaxed));
        self.read_pos.store(rp + 1, Ordering::Release);
        Some(val)
    }
}

struct StreamingSource {
    ring: Arc<SampleRing>,
    channels: u16,
    sample_rate: u32,
    total_duration: Option<std::time::Duration>,
}

/// Probe the data and extract metadata without decoding.
struct ProbeResult {
    channels: u16,
    sample_rate: u32,
    total_duration: Option<std::time::Duration>,
    track_id: u32,
}

fn probe_audio(data: &[u8]) -> Result<ProbeResult, String> {
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::meta::MetadataOptions;

    let cursor = std::io::Cursor::new(data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let probed = symphonia::default::get_probe()
        .format(&Hint::new(), mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("probe error: {e}"))?;

    let track = probed.format.default_track()
        .ok_or_else(|| "no default track".to_string())?;

    let channels = track.codec_params.channels
        .map(|c| c.count() as u16).unwrap_or(2);
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48000);
    let track_id = track.id;

    let total_duration = track.codec_params.n_frames.map(|frames| {
        std::time::Duration::from_secs_f64(frames as f64 / sample_rate as f64)
    });

    Ok(ProbeResult { channels, sample_rate, total_duration, track_id })
}

/// Spawn a background thread that decodes all packets into the ring buffer.
/// If `seek_to_secs` > 0, seek inside the container before decoding.
fn spawn_decoder(data: Vec<u8>, track_id: u32, ring: Arc<SampleRing>, seek_to_secs: f64) {
    std::thread::spawn(move || {
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::probe::Hint;
        use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::codecs::DecoderOptions;
        use symphonia::core::units::Time;

        let cursor = std::io::Cursor::new(data);
        let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

        let probed = match symphonia::default::get_probe()
            .format(&Hint::new(), mss, &FormatOptions::default(), &MetadataOptions::default()) {
            Ok(p) => p,
            Err(e) => { eprintln!("[Audio] decoder thread probe error: {e}"); ring.done.store(true, Ordering::Release); return; }
        };

        let mut format = probed.format;
        let track = match format.default_track() {
            Some(t) => t,
            None => { ring.done.store(true, Ordering::Release); return; }
        };

        let mut decoder = match symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default()) {
            Ok(d) => d,
            Err(e) => { eprintln!("[Audio] decoder thread codec error: {e}"); ring.done.store(true, Ordering::Release); return; }
        };

        // Seek inside the container if requested (much faster than skipping samples)
        if seek_to_secs > 0.05 {
            let seek_to = SeekTo::Time { time: Time::from(seek_to_secs), track_id: None };
            match format.seek(SeekMode::Coarse, seek_to) {
                Ok(_seeked) => {
                    eprintln!("[Audio] decoder seeked to {seek_to_secs:.1}s");
                }
                Err(e) => {
                    eprintln!("[Audio] decoder seek failed: {e}, decoding from start");
                }
            }
        }

        loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(symphonia::core::errors::Error::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(symphonia::core::errors::Error::ResetRequired) => break,
                Err(_) => break,
            };
            if packet.track_id() != track_id { continue; }

            let decoded = match decoder.decode(&packet) {
                Ok(d) => d,
                Err(_) => continue,
            };

            let spec = *decoded.spec();
            let num_frames = decoded.frames();
            let mut sample_buf = symphonia::core::audio::SampleBuffer::<f32>::new(
                num_frames as u64, spec,
            );
            sample_buf.copy_interleaved_ref(decoded);

            for &s in sample_buf.samples() {
                // Spin-wait if ring is full (backpressure)
                while !ring.push(s) {
                    std::thread::sleep(std::time::Duration::from_micros(100));
                }
            }
        }

        ring.done.store(true, Ordering::Release);
        eprintln!("[Audio] decoder thread finished, wrote {} samples", ring.write_pos.load(Ordering::Relaxed));
    });
}

impl StreamingSource {
    fn new(data: Vec<u8>) -> Result<Self, String> {
        Self::new_with_seek(data, 0.0)
    }

    fn new_with_seek(data: Vec<u8>, seek_to_secs: f64) -> Result<Self, String> {
        let info = probe_audio(&data)?;

        // Ring buffer: ~10 seconds of audio as headroom
        let ring_cap = (info.sample_rate as usize) * (info.channels as usize) * 10;
        let ring = Arc::new(SampleRing::new(ring_cap));

        spawn_decoder(data, info.track_id, Arc::clone(&ring), seek_to_secs);

        eprintln!("[Audio] Streaming decoder started: {}ch, {}Hz, seek={seek_to_secs:.1}s", info.channels, info.sample_rate);

        Ok(StreamingSource {
            ring,
            channels: info.channels,
            sample_rate: info.sample_rate,
            total_duration: info.total_duration,
        })
    }
}

impl Iterator for StreamingSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        // Try to pop a sample; if empty, check if decoder is done
        loop {
            if let Some(s) = self.ring.pop() {
                return Some(s);
            }
            if self.ring.done.load(Ordering::Acquire) {
                // Drain any remaining samples
                return self.ring.pop();
            }
            // Decoder still running but buffer empty — brief wait
            std::thread::sleep(std::time::Duration::from_micros(50));
        }
    }
}

impl rodio::Source for StreamingSource {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { self.channels }
    fn sample_rate(&self) -> u32 { self.sample_rate }
    fn total_duration(&self) -> Option<std::time::Duration> { self.total_duration }
}

// ── Rust Audio Player ─────────────────────────────────────────────────────────
// Audio output is routed through kiyoshi-music.exe (not WebView2/msedgewebview2).
// This makes the app visible as "Kiyoshi Music" in OBS Application Audio Capture.

enum AudioCmd {
    Play { url: String, seek_to: f64 },
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
}

struct AudioPlayer(Mutex<Option<std::sync::mpsc::SyncSender<AudioCmd>>>);

fn start_audio_thread(app: tauri::AppHandle) -> std::sync::mpsc::SyncSender<AudioCmd> {
    let (tx, rx) = std::sync::mpsc::sync_channel::<AudioCmd>(64);

    std::thread::spawn(move || {
        // OutputStream must be kept alive on this thread (not Send on Windows).
        let output = rodio::OutputStream::try_default();
        let (_stream, handle) = match output {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("[Audio] Output init failed: {e}");
                return;
            }
        };

        let mut sink: Option<rodio::Sink> = None;
        let mut audio_data: Option<Vec<u8>> = None; // cached last track data (for replay/seek)
        let mut duration: f64 = 0.0;
        let mut volume: f32 = 0.16f32; // default: 0.4² quadratic curve = 0.16
        let mut seek_offset: f64 = 0.0; // added to sink.get_pos() after seek-by-recreate

        // Channel for async-downloaded audio: (data_bytes, seek_to_seconds, generation)
        let (data_tx, data_rx) = std::sync::mpsc::channel::<(Vec<u8>, f64, u64)>();
        let mut play_gen: u64 = 0; // incremented on each Play command

        loop {
            // 1 ── Ingest newly downloaded audio data
            while let Ok((data, seek_to, gen)) = data_rx.try_recv() {
                // Ignore downloads from a previous Play command (user skipped track)
                if gen != play_gen {
                    eprintln!("[Audio] Ignoring stale download (gen {gen} != {play_gen})");
                    continue;
                }
                eprintln!("[Audio] Received {} bytes for decoding", data.len());
                if let Some(s) = sink.take() { s.stop(); }
                duration = 0.0;
                seek_offset = 0.0;
                audio_data = Some(data.clone());

                match StreamingSource::new(data) {
                    Ok(source) => {
                        duration = source.total_duration()
                            .map(|d| d.as_secs_f64())
                            .unwrap_or(0.0);
                        eprintln!("[Audio] Streaming started, duration={duration:.1}s");
                        match rodio::Sink::try_new(&handle) {
                            Ok(new_sink) => {
                                new_sink.set_volume(volume);
                                new_sink.append(source);
                                if seek_to > 0.05 {
                                    let _ = new_sink.try_seek(
                                        std::time::Duration::from_secs_f64(seek_to),
                                    );
                                }
                                let _ = app.emit(
                                    "audio-loaded",
                                    serde_json::json!({ "duration": duration }),
                                );
                                sink = Some(new_sink);
                            }
                            Err(e) => eprintln!("[Audio] Sink error: {e}"),
                        }
                    }
                    Err(e) => {
                        eprintln!("[Audio] Decode error: {e}");
                        let _ = app.emit("audio-error", format!("{e}"));
                    }
                }
            }

            // 2 ── Process commands from frontend
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    AudioCmd::Play { url, seek_to } => {
                        // Stop current playback and load new track in background
                        if let Some(s) = sink.take() { s.stop(); }
                        duration = 0.0;
                        seek_offset = 0.0;
                        audio_data = None;
                        play_gen += 1;
                        let gen = play_gen;
                        let dtx = data_tx.clone();
                        let dl_app = app.clone();

                        std::thread::spawn(move || {
                            let result = if url.starts_with("file://") {
                                // Local file path — read directly from disk (instant)
                                let path = url.strip_prefix("file://").unwrap();
                                // Handle URL-encoded paths and forward slashes
                                let path = path.replace("%20", " ");
                                eprintln!("[Audio] Reading from disk (gen {gen}): {path}");
                                std::fs::read(&path).map_err(|e| format!("File read error: {e}"))
                            } else {
                                // HTTP URL — download via reqwest
                                eprintln!("[Audio] HTTP download (gen {gen}): {}…", &url[..url.len().min(80)]);
                                (|| -> Result<Vec<u8>, String> {
                                    let client = reqwest::blocking::Client::builder()
                                        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                                        .timeout(std::time::Duration::from_secs(120))
                                        .build().map_err(|e| e.to_string())?;
                                    let resp = client.get(&url).send().map_err(|e| e.to_string())?;
                                    if !resp.status().is_success() {
                                        return Err(format!("HTTP {}", resp.status()));
                                    }
                                    resp.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
                                })()
                            };
                            match result {
                                Ok(data) => {
                                    eprintln!("[Audio] Loaded {} bytes (gen {gen})", data.len());
                                    let _ = dtx.send((data, seek_to, gen));
                                }
                                Err(e) => {
                                    eprintln!("[Audio] Load error (gen {gen}): {e}");
                                    let _ = dl_app.emit("audio-error", format!("Load failed: {e}"));
                                }
                            }
                        });
                    }
                    AudioCmd::Pause => {
                        if let Some(s) = &sink { s.pause(); }
                    }
                    AudioCmd::Resume => {
                        if let Some(s) = &sink { s.play(); }
                    }
                    AudioCmd::Stop => {
                        if let Some(s) = sink.take() { s.stop(); }
                        duration = 0.0;
                        audio_data = None;
                    }
                    AudioCmd::Seek(t) => {
                        // StreamingSource is not seekable via rodio's try_seek,
                        // so we recreate the decoder with symphonia-level seek.
                        if let Some(ref data) = audio_data {
                            let was_paused = sink.as_ref().map(|s| s.is_paused()).unwrap_or(false);
                            if let Some(s) = sink.take() { s.stop(); }
                            if let Ok(source) = StreamingSource::new_with_seek(data.clone(), t) {
                                seek_offset = t;
                                if let Ok(new_sink) = rodio::Sink::try_new(&handle) {
                                    new_sink.set_volume(volume);
                                    new_sink.append(source);
                                    if was_paused { new_sink.pause(); }
                                    sink = Some(new_sink);
                                    eprintln!("[Audio] Seeked to {t:.1}s");
                                }
                            }
                        }
                    }
                    AudioCmd::SetVolume(v) => {
                        volume = v;
                        if let Some(s) = &sink { s.set_volume(v); }
                    }
                }
            }

            // 3 ── Emit progress and detect end-of-track
            if let Some(s) = &sink {
                let pos = s.get_pos().as_secs_f64() + seek_offset;
                let paused = s.is_paused();
                let ended = s.empty();

                let _ = app.emit(
                    "audio-progress",
                    serde_json::json!({
                        "position": pos,
                        "duration": duration,
                        "paused":   paused,
                    }),
                );

                if ended {
                    sink = None;
                    duration = 0.0;
                    let _ = app.emit("audio-ended", ());
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    tx
}

struct ServerProcess(Mutex<Option<std::process::Child>>);
struct WasMaximized(Mutex<bool>);
struct DiscordRpc(Mutex<Option<DiscordIpcClient>>);

#[tauri::command]
fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool, state: tauri::State<WasMaximized>) {
    if fullscreen {
        // Remember if the window was maximised so we can restore it later
        let maximized = window.is_maximized().unwrap_or(false);
        *state.0.lock().unwrap() = maximized;

        if maximized {
            // Unmaximise first — a maximised window keeps its invisible
            // WS_THICKFRAME border which causes a gap at the bottom.
            let _ = window.unmaximize();
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_fullscreen(false);
        let _ = window.set_always_on_top(false);
        // Restore maximised state if it was maximised before
        if *state.0.lock().unwrap() {
            std::thread::sleep(std::time::Duration::from_millis(80));
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
async fn open_login_window(app: tauri::AppHandle, profile_name: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("login") {
        let _ = w.destroy();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let _win = tauri::WebviewWindowBuilder::new(
        &app,
        "login",
        tauri::WebviewUrl::External(
            "https://accounts.google.com/AccountChooser?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&flowName=GlifWebSignIn"
                .parse()
                .unwrap(),
        ),
    )
    .title("Kiyoshi Music – Anmelden")
    .inner_size(900.0, 680.0)
    .center()
    .decorations(true)
    .build()
    .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let profile = profile_name.clone();

    tauri::async_runtime::spawn(async move {
        let yt_url: url::Url = "https://music.youtube.com".parse().unwrap();
        // Wait a bit before starting to poll so the window can load its initial URL
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let mut completed = false;
        // Poll up to 5 minutes (150 × 2s)
        for _ in 0..150 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            let Some(win) = app_clone.get_webview_window("login") else {
                // Window was closed manually by the user
                break;
            };

            // Only capture cookies once the user has actually landed on music.youtube.com
            let current_url = win.url().ok().map(|u| u.to_string()).unwrap_or_default();
            if !current_url.contains("music.youtube.com") {
                continue;
            }

            if let Ok(cookies) = win.cookies_for_url(yt_url.clone()) {
                let has_auth = cookies.iter().any(|c| c.name() == "SAPISID");
                if has_auth {
                    let cookie_str = cookies
                        .iter()
                        .map(|c| format!("{}={}", c.name(), c.value()))
                        .collect::<Vec<_>>()
                        .join("; ");

                    let client = reqwest::Client::new();
                    let _ = client
                        .post("http://localhost:9847/auth/cookie-login")
                        .json(&serde_json::json!({
                            "cookie": cookie_str,
                            "profile_name": profile,
                            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }))
                        .send()
                        .await;

                    let _ = win.destroy();
                    let _ = app_clone.emit("login-complete", &profile);
                    completed = true;
                    break;
                }
            }
        }
        // If the loop ended without success (window closed or timed out), notify frontend
        if !completed {
            let _ = app_clone.emit("login-cancelled", ());
        }
    });

    Ok(())
}

#[tauri::command]
fn close_login_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("login") {
        let _ = w.destroy();
    }
}

#[tauri::command]
fn update_discord_rpc(
    state: tauri::State<'_, DiscordRpc>,
    title: String,
    artist: String,
    album: String,
    thumbnail: String,
    duration: f64,
    elapsed: f64,
    video_id: String,
    paused: bool,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Auto-reconnect if client isn't connected yet (e.g. Discord started after Kiyoshi)
    if guard.is_none() {
        if let Ok(mut client) = DiscordIpcClient::new("1483291004067909642") {
            if client.connect().is_ok() {
                *guard = Some(client);
            }
        }
    }

    let client = guard.as_mut().ok_or("Discord not running")?;

    let yt_url = format!("https://music.youtube.com/watch?v={}", video_id);

    let assets = activity::Assets::new()
        .large_image(&thumbnail)
        .large_text(&album);
    let button = activity::Button::new("Auf YouTube Music anhören", &yt_url);

    let paused_state = format!("{} · ⏸", artist);
    let state_str = if paused { &paused_state } else { &artist };

    let mut act = activity::Activity::new()
        .activity_type(activity::ActivityType::Listening)
        .details(&title)
        .state(state_str)
        .assets(assets)
        .buttons(vec![button]);

    if !paused {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let start = now - elapsed as i64;
        let end = if duration > 0.0 { now + (duration - elapsed) as i64 } else { 0 };
        act = act.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    // Try to set activity; on failure, reconnect once and retry silently
    match client.set_activity(act.clone()) {
        Ok(_) => {}
        Err(_) => {
            // Connection may have dropped — try reconnecting
            if client.reconnect().is_ok() {
                let _ = client.set_activity(act);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn clear_discord_rpc(state: tauri::State<'_, DiscordRpc>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

// ── OBS Audio Capture Fix ────────────────────────────────────────────────────
// Tauri plays audio through WebView2 (msedgewebview2.exe). OBS Application Audio
// Capture looks up sessions by process name and finds nothing under "Kiyoshi Music".
// This background thread enumerates WASAPI sessions every 3 seconds and renames
// any session owned by a WebView2 process to "Kiyoshi Music", so OBS finds it.
#[cfg(windows)]
fn tag_webview2_audio_sessions() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::{
        core::*,
        Win32::Foundation::*,
        Win32::Media::Audio::*,
        Win32::System::Com::*,
        Win32::System::Threading::*,
    };
    unsafe {
        // Initialize COM on this thread (ignore if already initialized)
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let Ok(enumerator) = CoCreateInstance::<_, IMMDeviceEnumerator>(
            &MMDeviceEnumerator, None, CLSCTX_ALL,
        ) else { return };

        let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
        else { return };

        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
        else { return };

        let Ok(session_enum) = manager.GetSessionEnumerator()
        else { return };

        let Ok(count) = session_enum.GetCount() else { return };

        for i in 0..count {
            let Ok(ctrl) = session_enum.GetSession(i) else { continue };
            let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else { continue };
            let Ok(pid) = ctrl2.GetProcessId() else { continue };
            if pid == 0 { continue; }

            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            else { continue };

            let mut buf = [0u16; 260];
            let mut len = 260u32;
            let is_webview = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            ).is_ok() && {
                let path = OsString::from_wide(&buf[..len as usize]);
                path.to_string_lossy().to_lowercase().contains("msedgewebview2")
            };

            let _ = CloseHandle(handle);

            if is_webview {
                let _ = ctrl.SetDisplayName(w!("Kiyoshi Music"), std::ptr::null());
            }
        }
    }
}

#[cfg(windows)]
fn start_audio_session_tagger() {
    std::thread::spawn(|| loop {
        tag_webview2_audio_sessions();
        std::thread::sleep(std::time::Duration::from_secs(3));
    });
}

// ── Audio IPC commands ────────────────────────────────────────────────────────

fn send_audio(state: &tauri::State<AudioPlayer>, cmd: AudioCmd) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.as_ref()
        .ok_or_else(|| "Audio player not initialized".to_string())?
        .send(cmd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn audio_play(state: tauri::State<AudioPlayer>, url: String, seek_to: f64) -> Result<(), String> {
    send_audio(&state, AudioCmd::Play { url, seek_to })
}

#[tauri::command]
fn audio_pause(state: tauri::State<AudioPlayer>) -> Result<(), String> {
    send_audio(&state, AudioCmd::Pause)
}

#[tauri::command]
fn audio_resume(state: tauri::State<AudioPlayer>) -> Result<(), String> {
    send_audio(&state, AudioCmd::Resume)
}

#[tauri::command]
fn audio_stop(state: tauri::State<AudioPlayer>) -> Result<(), String> {
    send_audio(&state, AudioCmd::Stop)
}

#[tauri::command]
fn audio_seek(state: tauri::State<AudioPlayer>, position: f64) -> Result<(), String> {
    send_audio(&state, AudioCmd::Seek(position))
}

#[tauri::command]
fn audio_set_volume(state: tauri::State<AudioPlayer>, volume: f32) -> Result<(), String> {
    send_audio(&state, AudioCmd::SetVolume(volume))
}

// ─────────────────────────────────────────────────────────────────────────────

fn wait_for_server(max_ms: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < max_ms as u128 {
        if let Ok(stream) = std::net::TcpStream::connect("127.0.0.1:9847") {
            drop(stream);
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    false
}

fn shutdown_via_http() {
    use std::io::Write;
    if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
        &"127.0.0.1:9847".parse().unwrap(),
        std::time::Duration::from_millis(500),
    ) {
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(500)));
        let _ = stream.write_all(b"POST /shutdown HTTP/1.0\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n");
    }
}

fn kill_existing_server(child: &mut Option<std::process::Child>) {
    // 1. Graceful shutdown via HTTP endpoint
    shutdown_via_http();
    std::thread::sleep(std::time::Duration::from_millis(400));

    // 2. Kill via stored child handle
    if let Some(mut c) = child.take() {
        let _ = c.kill();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    // 3. Kill by process name + port as fallback (platform-specific)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "kiyoshi-server-x86_64-pc-windows-msvc.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        // Also kill legacy binary name from Alpha 8 and below
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", "kiyoshi-server.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = std::process::Command::new("netstat")
            .args(["-ano"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains(":9847") && line.contains("LISTENING") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(pid) = parts.last() {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID", pid])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "kiyoshi-server"])
            .output();
        // Kill any remaining process on port 9847
        let _ = std::process::Command::new("fuser")
            .args(["-k", "9847/tcp"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Disable broken GPU compositing paths on WebKitGTK
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(ServerProcess(Mutex::new(None)))
        .manage(WasMaximized(Mutex::new(false)))
        .manage({
            let drpc: Option<DiscordIpcClient> = (|| {
                let mut client = DiscordIpcClient::new("1483291004067909642").ok()?;
                client.connect().ok()?;
                Some(client)
            })();
            DiscordRpc(Mutex::new(drpc))
        })
        // AudioPlayer holds the command sender; None until setup() runs.
        .manage(AudioPlayer(Mutex::new(None)))
        .setup(|app| {
            // Start the Rust audio player — audio plays through kiyoshi-music.exe,
            // so OBS Application Audio Capture can find it under "Kiyoshi Music".
            let audio_tx = start_audio_thread(app.handle().clone());
            *app.state::<AudioPlayer>().0.lock().unwrap() = Some(audio_tx);

            // WASAPI session tagger kept for reference (no longer the primary fix)
            #[cfg(windows)]
            start_audio_session_tagger();

            #[cfg(not(debug_assertions))]
            {
                // Kill any leftover server from a previous run
                let mut none: Option<std::process::Child> = None;
                kill_existing_server(&mut none);

                // Server binary name matches the Tauri externalBin target-triple convention
                #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
                let server_bin = "kiyoshi-server-x86_64-pc-windows-msvc.exe";
                #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
                let server_bin = "kiyoshi-server-x86_64-unknown-linux-gnu";
                #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
                let server_bin = "kiyoshi-server-aarch64-unknown-linux-gnu";
                #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
                let server_bin = "kiyoshi-server-x86_64-apple-darwin";
                #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
                let server_bin = "kiyoshi-server-aarch64-apple-darwin";

                let exe_dir = std::env::current_exe().ok()
                    .and_then(|e| e.parent().map(|p| p.to_path_buf()))
                    .unwrap_or_else(|| std::path::PathBuf::from("."));
                let server_exe = exe_dir.join(server_bin);

                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    if let Ok(child) = std::process::Command::new(&server_exe)
                        .creation_flags(CREATE_NO_WINDOW)
                        .spawn()
                    {
                        *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);
                    }
                }
                #[cfg(not(windows))]
                {
                    if let Ok(child) = std::process::Command::new(&server_exe).spawn() {
                        *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);
                    }
                }

                wait_for_server(10000);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_fullscreen, open_login_window, close_login_window,
            update_discord_rpc, clear_discord_rpc,
            audio_play, audio_pause, audio_resume, audio_stop, audio_seek, audio_set_volume,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Close Discord RPC connection — clear activity first, then disconnect
                let drpc: tauri::State<DiscordRpc> = app_handle.state();
                if let Ok(mut guard) = drpc.0.lock() {
                    if let Some(client) = guard.as_mut() {
                        let _ = client.clear_activity();
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        let _ = client.close();
                    }
                }
                // Kill server
                let state: tauri::State<ServerProcess> = app_handle.state();
                let mut child_opt = state.0.lock().ok().and_then(|mut g| g.take());
                kill_existing_server(&mut child_opt);
            }
        });
}
