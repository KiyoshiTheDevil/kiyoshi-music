# Changelog

All notable changes to Kiyoshi Music are documented here.

---

## [0.9.21-beta] — 2026-04-27

### Diagnostics
- **Library inspection on Linux startup** — eight env-var iterations haven't fixed the EGL crash on Steam Deck. The error comes from WebKit's hardcoded `GLDisplay::create()` which calls `CRASH()` if `eglGetDisplay()` fails. New build prints the actual libraries available on the host (via `ldconfig -p`) and what graphics libs are bundled in the AppImage's `usr/lib/`. This will reveal whether: (a) the host is missing required libraries, (b) `LINUXDEPLOY_EXCLUDE_LIST` actually worked or libraries are still bundled, (c) there's an ABI mismatch between bundled and host libs.
- **Cleaned up env-var soup** — removed conflicting/non-functional flags (e.g. `EGL_PLATFORM=surfaceless` which only affects `eglGetPlatformDisplay`, not the legacy `eglGetDisplay` that WebKit uses). Kept only the seven flags that have any chance of being respected.

---

## [0.9.20-beta] — 2026-04-27

### Bug Fixes
- **Linux AppImage white window (8th attempt)** — v0.9.19 confirmed the server now starts correctly and the binary mismatch is fixed, but EGL still aborts. New hypothesis: the "Aborting..." comes from GTK/GDK itself trying to use GL during init, before WebKit even starts. New env vars target GDK directly:
  - `GDK_GL=disable` — disable GDK's GL usage entirely
  - `GDK_DEBUG=gl-disable` — same hint via debug flag
  - `GDK_RENDERING=image` — force CPU-only Cairo image surface rendering
  - `GSK_RENDERER=cairo` — for GTK 4 (in case)
  - `GST_GL_DISABLED=1` — disable GStreamer GL plugins
- **Disabled `bundleMediaFramework`** — was bundling GStreamer GL plugins which try to init EGL on startup. Audio playback uses Rust's rodio, not GStreamer, so this should have no functional impact.

---

## [0.9.19-beta] — 2026-04-27

### Bug Fixes
- **Sidecar binary not found** — The v0.9.18-beta debug listing revealed the binary IS bundled, but Tauri strips the target-triple suffix on Linux: it's bundled as `kiyoshi-server` (not `kiyoshi-server-x86_64-unknown-linux-gnu`). The Rust code was looking for the suffixed name and never finding it. `start_server` now searches for both names — with and without the target-triple suffix.

---

## [0.9.18-beta] — 2026-04-27

### Bug Fixes
- **Linux AppImage white window (7th attempt)** — env-var workarounds didn't fix EGL_BAD_PARAMETER on Steam Deck because the bundled libEGL/libGL/libgbm in the AppImage were incompatible with the host's Mesa drivers. New fix: tell `linuxdeploy` to **exclude** all GL/EGL/DRM/Wayland/X11 graphics libraries from the AppImage via `LINUXDEPLOY_EXCLUDE_LIST`. The AppImage now uses the host system's Mesa drivers — guaranteed compatible with the host's GPU and kernel.
- **Server binary diagnostics** — Recursive walk depth increased from 4 to 8. Added a build-time AppImage content listing step that runs after the AppImage is produced, so we can see exactly what's bundled (helps diagnose where the sidecar ends up, if anywhere).

---

## [0.9.17-beta] — 2026-04-27

### Bug Fixes
- **Linux AppImage white window (6th attempt)** — `LIBGL_ALWAYS_SOFTWARE=1` from v0.9.16-beta wasn't enough — Mesa's EGL platform detection was still failing before the GL driver was selected. New env vars:
  - `EGL_PLATFORM=surfaceless` — bypasses display platform negotiation entirely; EGL never needs to bind to X11/Wayland
  - `MESA_LOADER_DRIVER_OVERRIDE=llvmpipe` — explicit software driver at the EGL/loader level (not just GL)
  - `WEBKIT_DISABLE_HARDWARE_ACCELERATION=1` — belt-and-suspenders WebKit hint
- **Server binary search now walks the AppImage tree** — known paths failed on v0.9.16, so `start_server` now recursively searches `$APPDIR` and the directories above the executable (depth 4) for the sidecar by name, with full diagnostic logging of every path attempted.

---

## [0.9.16-beta] — 2026-04-27

### Bug Fixes
- **Linux AppImage white window (5th attempt)** — Diagnostics from v0.9.15-beta on Steam Deck (KDE Wayland, AMD GPU) revealed `Could not create default EGL display: EGL_BAD_PARAMETER` — WebKit's GPU process was crashing during EGL init. Fixes:
  - Force Mesa software rasterizer via `LIBGL_ALWAYS_SOFTWARE=1` and `GALLIUM_DRIVER=llvmpipe` (slower, but guaranteed to render). Earlier concern about software rendering hurting AMD performance was wrong — when hardware EGL is broken, software is the only option.
  - When GDK_BACKEND was forced to x11 on a Wayland system, prefer `wayland,x11` so EGL gets the native platform first.
- **Sidecar binary search** — The Python server binary (`kiyoshi-server`) was not found at the expected `/usr/bin/` path inside the AppImage. `start_server` now tries multiple locations (`/usr/bin/`, `/usr/lib/`, `/usr/libexec/`, `/usr/lib/kiyoshi-music/`) and logs all attempted paths if it can't find the binary.

---

## [0.9.15-beta] — 2026-04-27

### New Features
- **Library search** — Search field in the Library view (right side of the sort row) filters playlists, albums or artists in real-time; resets on tab change
- **Select All checkbox** — Master checkbox in the playlist/album column header selects or deselects all visible tracks at once (respecting the search filter)
- **Buy Me a Coffee button** — Added to the About page in Settings

### Improvements
- **History view redesign** — Now uses the same hero header layout as Liked Songs (cover art, title, song count, play button, back button); "Clear History" button moved to the action row, right side
- **Liked Songs back button** — Always active and routes to the previous view (or Home if accessed directly via sidebar)
- **Animation toggle** — Now disables ALL transitions and animations globally via a single CSS rule with `!important`; previously many hardcoded transitions were ignoring the toggle

### Bug Fixes
- **Linux AppImage white window (4th attempt)** — Made external CSS/font loads non-blocking (Google Fonts and FontAwesome no longer delay first paint); added HTML-level boot splash that's visible immediately on parse; added `WEBKIT_DISABLE_ACCELERATED_2D_CANVAS=1`, `__GL_THREADED_OPTIMIZATIONS=0` and `WEBKIT_FORCE_COMPLEX_TEXT=0` env vars; added `[kiyoshi]` and `[boot]` diagnostic logging visible from terminal

### Internal
- Suppressed three Rust dead-code warnings (`capacity`, `wait_for_server`, `start_server`) with `#[allow(dead_code)]`

---

## [0.9.14-beta] — 2026-04-21

### New Features
- **About Song tab** — Queue panel now has a toggle between "Queue" and "About Song"; the About Song view shows the full YouTube description (lyrics credits, label, release date, composers, producers) fetched directly from YouTube via the InnerTube API
- **Artist Radio** — New Radio button on artist pages starts an instant radio session based on the artist; styled as a chip next to the Subscribe button
- **Library sorting** — Sort pill buttons below the library tabs: A→Z, Z→A, by artist; album tab additionally offers year (newest/oldest first)

### Improvements
- **Monthly listeners** — Artist page now correctly shows `monthlyListeners` (e.g. 42.9M) instead of total YouTube view count
- **Artist description panel** — Responsive width (`clamp`), no border, positioned independently of the radio/subscribe row to avoid layout conflicts

### Bug Fixes
- **Radio tracks missing album art** — `/radio/` backend endpoint now correctly handles both `thumbnails` (list) and `thumbnail` (string) formats returned by `get_watch_playlist()`

---

## [0.9.13-beta] — 2026-04-18

### New Features
- **Clickable multi-artist links** — Tracks with multiple artists now show each artist as a separate clickable link in the player bar, queue, expanded player and OBS overlay; clicking navigates directly to that artist's page
- **Scroll Speed preview** — Animated preview box in the OBS Overlay settings (between "Scroll Long Titles" and the speed slider) shows exactly how fast the title will scroll at the current setting

### Improvements
- **Contributor profile images** — KiyoshiTheDevil, Grains Of Art and LMary52 now display their real profile pictures in the About tab
- **New Teto artwork** — Updated illustration (Teto_Drinking_Boba) with correct aspect ratio, positioned so she appears to stand on the player bar
- **Additional social links** — Grains Of Art: Linktree; LMary52: TikTok

### Bug Fixes
- **Context menu submenu direction** — "Add to Playlist" submenu now opens to the left when there is not enough space on the right, preventing it from going off-screen
- **OBS overlay stays open on artist click** — Clicking an artist name in the compact player bar no longer closes the OBS overlay
- **Discord Rich Presence** — Rich Presence activity now updates reliably again; fixed regression introduced in v0.9.10-beta

---

## [0.9.12-beta] — 2026-04-18

### Bug Fixes
- **Linux AppImage white window (3rd attempt)** — Added `'unsafe-inline'` to `script-src` in Tauri CSP (WebKitGTK enforces CSP strictly; missing `'unsafe-inline'` can block Tauri's init scripts); unified CSP between `tauri.conf.json` and `index.html` meta tag; added dark `#0d0d0d` body background as HTML-level fallback so the window is never white even if React hasn't mounted yet
- **Reverted `visible: false`** — Made things worse because `appWindow.show()` was never called when JS failed to run

---

## [0.9.11-beta] — 2026-04-18

### New Features
- **Single Instance** — Launching the app a second time now focuses the existing window instead of creating a new process and tray icon

### Bug Fixes
- **Language picker button cut off** — On small viewports or high-DPI displays the language list is now scrollable and the Confirm button always stays visible at the bottom

---

## [0.9.10-beta] — 2026-04-18

### Bug Fixes
- **Linux AppImage white window (2nd attempt)** — Added `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` (correct env var for WebKit2GTK sandbox) and `LIBGL_ALWAYS_SOFTWARE=1` (software OpenGL fallback); window now starts hidden (`visible: false`) and is shown once React has mounted, so the splash screen appears instead of a blank white frame
- **Discord button localisation** — "Listen on YouTube Music" button text is now passed from the frontend and follows the app language setting

---

## [0.9.9-beta] — 2026-04-18

### New Features
- **Contributors in About tab** — Four contributors listed with social link buttons (Twitch, YouTube, Bluesky, Webpage) per card; brand icons via Font Awesome

### Improvements
- **OBS Overlay font picker** — Refresh button next to the local fonts search field; icon spins while reloading
- **Backend stability** — Overlay server thread now catches unexpected exceptions instead of dying silently; completed download/export status entries cleaned up from memory after 5 minutes

### Bug Fixes
- **Linux AppImage white window** — Server startup moved off the main thread; the Tauri event loop is no longer blocked during server startup, fixing the blank window on launch
- **Linux WebKit compatibility** — Added `WEBKIT_FORCE_SANDBOX=0` (required in AppImage) and automatic `GDK_BACKEND=x11` on Wayland for better WebKitGTK rendering

---

## [0.9.8-beta] — 2026-04-17

### New Features
- **Like hearts in playlist rows** — Heart button next to the three-dots in all playlist views (Liked Songs, Collections/Albums, Downloads); shows per-track liked state, toggling syncs to YouTube Music instantly
- **"Like Song" in player more-menu** — Three-dot menu in the player now includes a Like/Unlike toggle for the currently playing track
- **"Like / Unlike" in track context menu** — Right-click context menu on any track now shows Like/Unlike with correct per-track state
- **"Add to Playlist" in player more-menu** — Three-dot menu in the player now supports adding the current track to any playlist

### Improvements
- **App-level liked state** — `likedIds` Set loaded from `/liked/ids` on startup; all views share a single source of truth and update optimistically with automatic rollback on error
- **OBS overlay border rendering** — Rewrote border layer as a sibling `div` with `path(evenodd)` donut clip; transparent widget backgrounds now render correctly without bleed-through
- **OBS overlay bevel border thickness** — Corrected perpendicular distance calculation for 45° cuts (`bw × (2 − √2)`) so bevel borders match straight-edge thickness exactly

### Bug Fixes
- Fixed `isLiked`/`toggleLike` out-of-scope reference in track context menu (was referencing Player-internal state from App scope)
- Fixed stray `onToggleLike` reference in HomeView Quick Picks rows causing a ReferenceError on startup

---

## [0.9.7-beta] — 2026-04-16

### New Features
- **Per-corner mixed corner style** — Widget frame and album art corners can now each be set to *rounded* or *beveled* independently per corner, allowing combinations like round top + beveled bottom
- **Corner preset buttons** — "All Round" and "All Bevel" quick-preset buttons in both the Appearance and Layout tabs for faster setup
- **OBS Overlay custom profiles** — Save the current overlay configuration as a named profile, load or delete saved profiles, export profiles as `.json` files (with native save dialog), import profiles from file, and restore factory defaults
- **OBS Overlay Content sub-tab** — Dedicated tab for visibility toggles: Album Art, Artist, Album, Progress Bar, Auto-Hide, Title Scroll and Scroll Speed

### Improvements
- **Icon refresh (Appearance tab)** — Background, Drop Shadow and Border rows now use matching custom icons; profile action buttons (Save, Import, Export) use Font Awesome icons
- **Icon refresh (Layout tab)** — Width, Height, Vertical Padding, Horizontal Padding, Spacing and Progress Bar Height rows now each use a dedicated icon instead of a generic slider icon
- **Inactive sub-tab labels** — Raised from `--text-muted` to `--text-secondary` for better readability
- **Slider values** — Raised from `--text-muted` to `--text-secondary`; hover still transitions to full `--text-primary`

### Internal
- Added `buildCornerPath(W, H, corners)` — generalised clip-path generator supporting both rounded (Q-Bézier) and beveled (straight-line) cuts on any rectangle size
- Added `FaIcon`, `PubIcon` and `CornerMaskIcon` helper components for consistent icon rendering across the settings panel
- OBS overlay profiles persisted in `localStorage` under `kiyoshi-obs-profiles`
- 9 new SVG icons added to the `public/` folder

---

## [0.9.6-beta] — 2026-04-09

### New Features
- **Built-in OBS Overlay server** — Live Now-Playing widget served directly from the app; no external tools required
- Overlay widget fully configurable via a dedicated settings panel (Appearance, Layout, Typography sub-tabs)
- Supports background blur/opacity, border, drop shadow, album art, scrolling title, progress bar and font customisation

### Bug Fixes
- Fixed `obsEnabled is not defined` runtime error caused by missing props in `SettingsPanel`

---

## [0.9.5-alpha.1] and earlier

Initial alpha releases — core YouTube Music playback, lyrics, Discord Rich Presence, system tray integration, auto-updater, theme engine and language support (German / English).
