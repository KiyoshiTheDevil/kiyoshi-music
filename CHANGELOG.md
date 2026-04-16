# Changelog

All notable changes to Kiyoshi Music are documented here.

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
