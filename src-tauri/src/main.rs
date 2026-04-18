#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod audio;
mod discord;
mod window;
mod server;
mod obs;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use audio::{AudioPlayer, start_audio_thread, audio_play, audio_pause, audio_resume, audio_stop, audio_seek, audio_set_volume};
use discord::{DiscordRpc, disconnect_rpc, update_discord_rpc, clear_discord_rpc};
use window::{WasMaximized, set_fullscreen, open_login_window, close_login_window};
use server::{ServerProcess, stop_server};
#[cfg(windows)]
use obs::start_audio_session_tagger;

#[cfg(target_os = "linux")]
use std::env;

struct AppTray(tauri::tray::TrayIcon<tauri::Wry>);
struct CloseTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<CloseTray>) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn stop_server_cmd(app: tauri::AppHandle) {
    server::stop_server(&app);
}

/// Rebuilds the tray menu with localised labels.
/// Called from the frontend whenever the language changes.
#[tauri::command]
fn update_tray_labels(app: tauri::AppHandle, show_label: String, quit_label: String) {
    let Some(tray) = app.try_state::<AppTray>() else { return };
    let Ok(show) = MenuItem::with_id(&app, "show", show_label, true, None::<&str>) else { return };
    let Ok(quit) = MenuItem::with_id(&app, "quit", quit_label, true, None::<&str>) else { return };
    let Ok(sep)  = PredefinedMenuItem::separator(&app) else { return };
    if let Ok(menu) = Menu::with_items(&app, &[&show, &sep, &quit]) {
        let _ = tray.0.set_menu(Some(menu));
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Disable GPU compositing — prevents blank/white window on many distros
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        // Disable DMABuf renderer — avoids driver-level render failures
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // Disable WebKit2GTK sandbox — AppImage FUSE mounts conflict with
        // the user-namespace sandbox; this is the correct env var name
        env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
        // Force software OpenGL — prevents GPU driver crashes on headless/
        // minimal installs that lack proper Mesa/DRI support
        env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        // On Wayland: force X11/XWayland backend for better WebKitGTK compatibility
        if env::var("WAYLAND_DISPLAY").is_ok() && env::var("GDK_BACKEND").is_err() {
            env::set_var("GDK_BACKEND", "x11");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerProcess::new())
        .manage(WasMaximized::new())
        .manage(DiscordRpc::new())
        .manage(AudioPlayer::new())
        .manage(CloseTray(AtomicBool::new(true)))
        .setup(|app| {
            let audio_tx = start_audio_thread(app.handle().clone());
            app.state::<AudioPlayer>().set_sender(audio_tx);

            #[cfg(windows)]
            start_audio_session_tagger();

            // ── System Tray ────────────────────────────────────────────────────
            let show = MenuItem::with_id(app, "show", "Show Kiyoshi Music", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep  = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Kiyoshi Music")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Links-Klick auf Tray-Icon → Fenster zeigen/fokussieren
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Store tray handle so update_tray_labels can call set_menu() on it
            app.manage(AppTray(tray));

            #[cfg(not(debug_assertions))]
            {
                // Spawn server startup on a background thread so the main event loop
                // is never blocked — a blocked setup() freezes WebKit rendering and
                // produces a white window, especially noticeable on Linux AppImage.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut none: Option<std::process::Child> = None;
                    server::kill_existing_server(&mut none);
                    server::start_server(&handle);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_fullscreen, open_login_window, close_login_window,
            update_discord_rpc, clear_discord_rpc,
            audio_play, audio_pause, audio_resume,
            audio_stop, audio_seek, audio_set_volume,
            relaunch_app, quit_app, stop_server_cmd,
            update_tray_labels, set_close_to_tray,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // X-Button → Fenster verstecken statt schließen
                tauri::RunEvent::WindowEvent { ref label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. }
                    if label == "main" =>
                {
                    if app_handle.state::<CloseTray>().0.load(Ordering::Relaxed) {
                        api.prevent_close();
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                }
                // Echtes Beenden (via Tray-Menü oder quit_app-Command)
                tauri::RunEvent::Exit => {
                    disconnect_rpc(app_handle);
                    stop_server(app_handle);
                }
                _ => {}
            }
        });
}
