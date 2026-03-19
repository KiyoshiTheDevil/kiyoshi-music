#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

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

    // 3. Kill by process name + port as fallback on Windows
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
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;

                // Kill any leftover server from a previous run
                let mut none: Option<std::process::Child> = None;
                kill_existing_server(&mut none);

                // Find server binary next to our own executable
                let server_exe = app.path()
                    .resource_dir()
                    .ok()
                    .and_then(|p| {
                        // resource_dir may point inside the bundle; walk up to exe dir
                        let exe_dir = std::env::current_exe().ok()
                            .and_then(|e| e.parent().map(|p| p.to_path_buf()));
                        exe_dir
                    })
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join("kiyoshi-server-x86_64-pc-windows-msvc.exe");

                if let Ok(child) = std::process::Command::new(&server_exe)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                {
                    *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);
                }

                wait_for_server(10000);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_fullscreen, open_login_window, close_login_window, update_discord_rpc, clear_discord_rpc])
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
