use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use tauri::Manager;

pub struct DiscordRpc(Mutex<Option<DiscordIpcClient>>);

impl DiscordRpc {
    pub fn new() -> Self {
        let drpc: Option<DiscordIpcClient> = (|| {
            let mut client = DiscordIpcClient::new("1483291004067909642").ok()?;
            client.connect().ok()?;
            Some(client)
        })();
        DiscordRpc(Mutex::new(drpc))
    }
}

#[tauri::command]
pub fn update_discord_rpc(
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
        let end = if duration > 0.0 {
            now + (duration - elapsed) as i64
        } else {
            0
        };
        act = act.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    match client.set_activity(act.clone()) {
        Ok(_) => {}
        Err(_) => {
            if client.reconnect().is_ok() {
                let _ = client.set_activity(act);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn clear_discord_rpc(state: tauri::State<'_, DiscordRpc>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

pub fn disconnect_rpc(app_handle: &tauri::AppHandle) {
    let drpc: tauri::State<DiscordRpc> = app_handle.state();
    let mut guard = match drpc.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = client.close();
    }
}
