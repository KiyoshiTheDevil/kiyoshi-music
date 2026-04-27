use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;

pub struct ServerProcess(Mutex<Option<Child>>);

impl ServerProcess {
    pub fn new() -> Self {
        ServerProcess(Mutex::new(None))
    }
}

#[allow(dead_code)]
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
        let _ = stream
            .write_all(b"POST /shutdown HTTP/1.0\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n");
    }
}

pub fn kill_existing_server(child: &mut Option<Child>) {
    shutdown_via_http();
    std::thread::sleep(std::time::Duration::from_millis(400));

    if let Some(mut c) = child.take() {
        let _ = c.kill();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
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
        let _ = std::process::Command::new("fuser")
            .args(["-k", "9847/tcp"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

#[allow(dead_code)]
pub fn start_server(app: &tauri::AppHandle) {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    let server_bin = "kiyoshi-server.exe";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    let server_bin = "kiyoshi-server-x86_64-unknown-linux-gnu";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    let server_bin = "kiyoshi-server-aarch64-unknown-linux-gnu";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let server_bin = "kiyoshi-server-x86_64-apple-darwin";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let server_bin = "kiyoshi-server-aarch64-apple-darwin";

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // Tauri strips the target-triple suffix when bundling the sidecar into
    // an AppImage (so it's just "kiyoshi-server"), but keeps it on Windows
    // (kiyoshi-server.exe stays the same). Search for both names.
    #[cfg(target_os = "linux")]
    let stripped_name = "kiyoshi-server";
    #[cfg(target_os = "macos")]
    let stripped_name = "kiyoshi-server";
    #[cfg(target_os = "windows")]
    let stripped_name = "kiyoshi-server.exe";

    // Try several locations — Tauri's AppImage bundling for externalBin sidecars
    // can place them at different paths depending on the bundler version.
    let mut candidates: Vec<std::path::PathBuf> = vec![];
    for name in [server_bin, stripped_name].iter().filter(|n| !n.is_empty()) {
        candidates.push(exe_dir.join(name));                              // /usr/bin/<bin>
        candidates.push(exe_dir.join("..").join("lib").join(name));       // /usr/lib/<bin>
        candidates.push(exe_dir.join("..").join("libexec").join(name));   // /usr/libexec/<bin>
        candidates.push(std::path::PathBuf::from("/usr/lib/kiyoshi-music").join(name));
        candidates.push(std::path::PathBuf::from("/usr/bin").join(name));
    }

    let server_exe = match candidates.iter().find(|p| p.exists()) {
        Some(p) => {
            eprintln!("[server] Found binary at: {}", p.display());
            p.clone()
        }
        None => {
            // Fallback: walk the AppImage / install tree to find the binary
            // by name. Tauri's AppImage bundler version determines where the
            // sidecar ends up — sometimes nested deep.
            eprintln!("[server] Binary '{}' not in expected paths. Walking the tree...", server_bin);
            let mut search_roots: Vec<std::path::PathBuf> = vec![];
            if let Ok(appdir) = std::env::var("APPDIR") {
                search_roots.push(std::path::PathBuf::from(appdir));
            }
            let mut p = exe_dir.clone();
            for _ in 0..3 {
                if let Some(parent) = p.parent() {
                    search_roots.push(parent.to_path_buf());
                    p = parent.to_path_buf();
                }
            }

            fn find_in(dir: &std::path::Path, name: &str, depth: u8) -> Option<std::path::PathBuf> {
                if depth == 0 { return None; }
                let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return None };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                        if fname == name && path.is_file() {
                            return Some(path);
                        }
                    }
                    if path.is_dir() {
                        if let Some(found) = find_in(&path, name, depth - 1) {
                            return Some(found);
                        }
                    }
                }
                None
            }

            let mut found = None;
            'outer: for root in &search_roots {
                eprintln!("[server]   walking: {}", root.display());
                for name in [server_bin, stripped_name].iter().filter(|n| !n.is_empty()) {
                    if let Some(p) = find_in(root, name, 8) {
                        eprintln!("[server]   found via walk: {}", p.display());
                        found = Some(p);
                        break 'outer;
                    }
                }
            }

            match found {
                Some(p) => p,
                None => {
                    eprintln!("[server] Binary '{}' not found anywhere.", server_bin);
                    eprintln!("[server] Searched paths:");
                    for p in &candidates {
                        eprintln!("[server]   - {}", p.display());
                    }
                    eprintln!("[server] Searched roots (recursive, depth 8):");
                    for r in &search_roots {
                        eprintln!("[server]   - {}", r.display());
                    }
                    return;
                }
            }
        }
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        match std::process::Command::new(&server_exe)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(child) => { *app.state::<ServerProcess>().0.lock().unwrap() = Some(child); }
            Err(e) => { eprintln!("[server] Failed to spawn {}: {}", server_exe.display(), e); return; }
        }
    }
    #[cfg(not(windows))]
    {
        match std::process::Command::new(&server_exe).spawn() {
            Ok(child) => { *app.state::<ServerProcess>().0.lock().unwrap() = Some(child); }
            Err(e) => { eprintln!("[server] Failed to spawn {}: {}", server_exe.display(), e); return; }
        }
    }

    // Wait for the server to accept connections (runs on a background thread,
    // so blocking here does NOT freeze the UI).
    wait_for_server(15000);
}

pub fn stop_server(app_handle: &tauri::AppHandle) {
    let state: tauri::State<ServerProcess> = app_handle.state();
    let mut child_opt = state.0.lock().ok().and_then(|mut g| g.take());
    kill_existing_server(&mut child_opt);
}
