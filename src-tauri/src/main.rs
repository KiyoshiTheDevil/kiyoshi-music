#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod audio;
mod discord;
mod window;
mod server;
mod obs;

use tauri::Manager;
use audio::{AudioPlayer, start_audio_thread, audio_play, audio_pause, audio_resume, audio_stop, audio_seek, audio_set_volume};
use discord::{DiscordRpc, disconnect_rpc, update_discord_rpc, clear_discord_rpc};
use window::{WasMaximized, set_fullscreen, open_login_window, close_login_window};
use server::{ServerProcess, stop_server};
use obs::start_audio_session_tagger;

#[cfg(target_os = "linux")]
use std::env;

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(ServerProcess::new())
        .manage(WasMaximized::new())
        .manage(DiscordRpc::new())
        .manage(AudioPlayer::new())
        .setup(|app| {
            let audio_tx = start_audio_thread(app.handle().clone());
            app.state::<AudioPlayer>().set_sender(audio_tx);

            #[cfg(windows)]
            start_audio_session_tagger();

            #[cfg(not(debug_assertions))]
            {
                let mut none: Option<std::process::Child> = None;
                server::kill_existing_server(&mut none);
                server::start_server(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_fullscreen, open_login_window, close_login_window,
            update_discord_rpc, clear_discord_rpc,
            audio_play, audio_pause, audio_resume,
            audio_stop, audio_seek, audio_set_volume,
            relaunch_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                disconnect_rpc(app_handle);
                stop_server(app_handle);
            }
        });
}
