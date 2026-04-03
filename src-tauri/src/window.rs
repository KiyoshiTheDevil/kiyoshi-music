use std::sync::Mutex;
use tauri::{Manager, Emitter};

pub struct WasMaximized(Mutex<bool>);

impl WasMaximized {
    pub fn new() -> Self {
        WasMaximized(Mutex::new(false))
    }
}

#[tauri::command]
pub fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool, state: tauri::State<WasMaximized>) {
    if fullscreen {
        let maximized = window.is_maximized().unwrap_or(false);
        *state.0.lock().unwrap() = maximized;

        if maximized {
            let _ = window.unmaximize();
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_fullscreen(false);
        let _ = window.set_always_on_top(false);
        if *state.0.lock().unwrap() {
            std::thread::sleep(std::time::Duration::from_millis(80));
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub async fn open_login_window(app: tauri::AppHandle, profile_name: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("login") {
        let _ = w.destroy();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    // Use a fresh isolated data directory each time so the login WebView never
    // inherits cached Google session cookies from a previous login.
    let login_data_dir = std::env::temp_dir().join("kiyoshi-login-webview");
    let _ = std::fs::remove_dir_all(&login_data_dir);

    let _win = tauri::WebviewWindowBuilder::new(
        &app,
        "login",
        tauri::WebviewUrl::External(
            "https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&flowName=GlifWebSignIn"
                .parse()
                .unwrap(),
        ),
    )
    .title("Kiyoshi Music – Anmelden")
    .inner_size(900.0, 680.0)
    .center()
    .decorations(true)
    .data_directory(login_data_dir)
    .build()
    .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let profile = profile_name.clone();

    tauri::async_runtime::spawn(async move {
        let yt_url: url::Url = "https://music.youtube.com".parse().unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let mut completed = false;

        for _ in 0..150 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            let Some(win) = app_clone.get_webview_window("login") else {
                break;
            };

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

        if !completed {
            let _ = app_clone.emit("login-cancelled", ());
        }
    });

    Ok(())
}

#[tauri::command]
pub fn close_login_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("login") {
        let _ = w.destroy();
    }
}
