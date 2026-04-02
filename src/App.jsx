import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
const appWindow = getCurrentWebviewWindow();
import { openUrl } from "@tauri-apps/plugin-opener";
import { LANGUAGES, translate } from "./i18n.js";
import {
  IconContext,
  Minus, X, Play, Pause,
  House, Books, Heart,
  CaretLineLeft, CaretLineRight,
  MagnifyingGlass, Gear, Palette, PlayCircle, Microphone,
  VinylRecord, MusicNote, Playlist, ImageSquare,
  DotsSixVertical,
  Shuffle, SkipBack, SkipForward, Repeat, RepeatOnce,
  SpeakerX, SpeakerLow, SpeakerHigh,
  Queue, ChatText,
  CaretUp, CaretDown,
  ArrowsIn, ArrowsOut,
  ArrowLeft,
  ArrowClockwise,
  Check,
  DotsThreeVertical,
  PushPin,
  ClockCounterClockwise,
  CaretLineUp,
  CheckCircle,
  Plus,
  DownloadSimple,
  Trash,
  PencilSimple,
  ArrowCircleUp,
  Copy,
  ArrowSquareOut,
  SunHorizon,
  Sun,
  CloudSun,
  Moon,
  MoonStars,
  Translate,
  Link,
  UploadSimple,
  PersonArmsSpread,
  Keyboard,
  PaintBrushBroad,
  HardDrives,
  ArrowsClockwise,
  Crown,
  WifiHigh,
  WifiX,
  Bug,
} from "@phosphor-icons/react";

const API = "http://localhost:9847";

// ─── Debug Console Interceptor ───────────────────────────────────────────────
// Captures all console.log/warn/error/info calls into a ring buffer so the
// Debug tab in Settings can display them even if DevTools is not open.
const _frontendLogs = [];
const _MAX_FRONTEND_LOGS = 500;
(function _setupDebugInterceptor() {
  const _orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  ["log", "warn", "error", "info"].forEach(level => {
    console[level] = (...args) => {
      _orig[level](...args);
      const msg = args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === "object" && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(" ");
      _frontendLogs.push({ ts: Date.now() / 1000, level: level.toUpperCase(), msg, source: "frontend" });
      if (_frontendLogs.length > _MAX_FRONTEND_LOGS) _frontendLogs.shift();
    };
  });
})();

// ─── App Version ─────────────────────────────────────────────────────────────
const APP_VERSION = "0.9.3-alpha";

// ─── Update Checker (GitHub Releases) ───────────────────────────────────────
const APP_TAG = "v0.9.0";
const GITHUB_RELEASES_API = "https://api.github.com/repos/KiyoshiTheDevil/kiyoshi-music/releases?per_page=1";

function isNewerVersion(latest, current) {
  const parse = v => v.replace(/^v/, "").split(".").map(n => parseInt(n) || 0);
  const l = parse(latest), c = parse(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

// Detect the best matching language from the browser/OS locale.
// Falls back to "en" for anything that isn't explicitly supported.
function detectSystemLang() {
  const supported = ["de", "en"]; // extend when more locales are added
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
  for (const loc of candidates) {
    const base = loc.split("-")[0].toLowerCase();
    if (supported.includes(base)) return base;
  }
  return "en";
}
// If no language has been saved yet, use the system locale.
function getInitialLang() {
  return localStorage.getItem("kiyoshi-lang") || detectSystemLang();
}

const LangContext = createContext("de");
const useLang = () => {
  const lang = useContext(LangContext);
  return (key) => translate(lang, key);
};

// Proxy YouTube thumbnails through local server to avoid CORS issues
const thumb = (url) => url ? `${API}/imgproxy?url=${encodeURIComponent(url)}` : "";

// ─── Animation Context ──────────────────────────────────────────────────────
const AnimationContext = createContext(true);
const useAnimations = () => useContext(AnimationContext);

// ─── Zoom Context ─────────────────────────────────────────────────────────────
const ZoomContext = createContext(1);
const useZoom = () => useContext(ZoomContext);

// ─── Font Scale Context ───────────────────────────────────────────────────────
const FontScaleContext = createContext(1);
const useFontScale = () => useContext(FontScaleContext);

// Stepped values for the zoom and font-size sliders
const ZOOM_STEPS      = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
const ZOOM_LABELS     = ["80%", "90%", "100%", "110%", "120%", "130%", "140%", "150%"];
const FONT_STEPS      = [0.85, 0.93, 1.0, 1.10, 1.20, 1.35, 1.50];
const FONT_LABELS     = FONT_STEPS.map(s => `${Math.round(13 * s)}px`);

// Spring physics: returns a CSS transition string
function spring(prop, opts = {}) {
  const { stiffness = "0.4s", fn = "cubic-bezier(0.34,1.56,0.64,1)" } = opts;
  return `${prop} ${stiffness} ${fn}`;
}

// Global keyframes injected once
const GLOBAL_KEYFRAMES = `
  @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }
  @keyframes flashbangFade { 0%,50%{opacity:1} 100%{opacity:0} }
  @keyframes tetoSlideIn {
    from { transform: translateX(110%); }
    to   { transform: translateX(0); }
  }
  @keyframes tetoSlideOut {
    from { transform: translateX(0); }
    to   { transform: translateX(110%); }
  }
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes coverPop {
    0%   { transform: scale(0.96); }
    60%  { transform: scale(1.03); }
    100% { transform: scale(1); }
  }
  @keyframes eqBar1 { 0%,100%{height:4px} 50%{height:14px} }
  @keyframes eqBar2 { 0%,100%{height:10px} 35%{height:3px} 70%{height:14px} }
  @keyframes eqBar3 { 0%,100%{height:7px} 45%{height:14px} 80%{height:3px} }
  @keyframes navPop {
    0%   { transform: scale(1); }
    40%  { transform: scale(0.88); }
    100% { transform: scale(1); }
  }
  @keyframes splashLogoIn {
    from { opacity: 0; transform: scale(0.65); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes splashTextIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes splashFadeOut {
    from { opacity: 1; transform: scale(1); }
    to   { opacity: 0; transform: scale(1.04); }
  }
  @keyframes splashGlow {
    0%,100% { transform: scale(1);   opacity: 0.6; }
    50%     { transform: scale(1.25); opacity: 1; }
  }
`;

const winCtrl = {
  minimize: () => appWindow.minimize(),
  maximize: () => appWindow.toggleMaximize(),
  close: () => appWindow.close(),
  startDrag: () => appWindow.startDragging(),
};

// Inject tooltip keyframes once
if (typeof document !== "undefined" && !document.getElementById("kiyoshi-tooltip-kf")) {
  const s = document.createElement("style");
  s.id = "kiyoshi-tooltip-kf";
  s.textContent = `
    @keyframes tooltipIn{from{opacity:0;transform:translate(-50%,calc(-100% + 4px))}to{opacity:1;transform:translate(-50%,-100%)}}
    @keyframes tooltipOut{from{opacity:1;transform:translate(-50%,-100%)}to{opacity:0;transform:translate(-50%,calc(-100% + 4px))}}
  `;
  document.head.appendChild(s);
}

function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const showTimer = useRef(null);
  const hideTimer = useRef(null);
  if (!text) return children;

  const hide = () => {
    clearTimeout(showTimer.current);
    if (visible) {
      setLeaving(true);
      hideTimer.current = setTimeout(() => { setVisible(false); setLeaving(false); }, 120);
    }
  };

  return (
    <span style={{ display: "contents" }}
      onMouseEnter={e => {
        clearTimeout(hideTimer.current);
        setLeaving(false);
        const el = e.currentTarget.firstElementChild || e.target;
        const r = el.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
        clearTimeout(showTimer.current);
        showTimer.current = setTimeout(() => setVisible(true), 350);
      }}
      onMouseLeave={hide}
    >
      {children}
      {visible && createPortal(
        <div style={{
          position: "fixed", left: pos.x, top: pos.y - 6,
          transform: "translate(-50%, -100%)",
          background: "var(--bg-elevated)", color: "var(--text-primary)",
          padding: "5px 9px", borderRadius: 6,
          fontSize: "var(--t11)", fontWeight: 500,
          pointerEvents: "none", zIndex: 99999,
          border: "0.5px solid var(--border)",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          animation: `${leaving ? "tooltipOut" : "tooltipIn"} 0.12s ease forwards`,
        }}>{text}</div>,
        document.body
      )}
    </span>
  );
}

// ── IpcAudio ─────────────────────────────────────────────────────────────────
// Drop-in replacement for `new Audio()` that routes playback through the Rust
// host process (kiyoshi-music.exe) instead of WebView2 / msedgewebview2.exe.
// This makes the audio session visible to OBS Application Audio Capture as
// "Kiyoshi Music".  The API surface mirrors the parts of HTMLAudioElement that
// the Player component uses, so no other code changes are required.
class IpcAudio {
  constructor() {
    this._src = "";
    this._srcDirty = false;   // true when src was set but play() not called yet
    this._pendingSeekTo = 0;  // seek target to use on the next play() call
    this._currentTime = 0;
    this._duration = 0;
    this._paused = true;
    this._volume = 0.16;      // same default as Rust thread (0.4² quadratic)
    this._listeners = {};
    this._invoke = null;      // resolved lazily on first use

    // Fallback: if Rust commands don't exist (binary not recompiled),
    // _fallback is set to a plain HTMLAudioElement and all calls route there.
    this._fallback = null;       // null = not decided, false = Rust works, Audio = fallback
    this._probePromise = null;   // dedup the one-time probe

    // Resolve Tauri invoke/listen modules asynchronously on construction.
    import("@tauri-apps/api/core").then(({ invoke }) => {
      this._invoke = invoke;
      // Probe immediately: try a harmless command to see if Rust audio exists.
      this._probe(invoke);
    });
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("audio-progress", ({ payload }) => {
        if (this._fallback) return; // ignore Rust events when in fallback mode
        this._currentTime = payload.position;
        if (payload.duration > 0) this._duration = payload.duration;
        if (payload.paused !== this._paused) this._paused = payload.paused;
        this._fire("timeupdate");
      });
      listen("audio-ended", () => {
        if (this._fallback) return;
        this._paused = true;
        this._fire("ended");
      });
      listen("audio-loaded", ({ payload }) => {
        if (this._fallback) return;
        if (payload.duration > 0) this._duration = payload.duration;
        this._fire("loadedmetadata");
        this._fire("canplay");
      });
      listen("audio-error", ({ payload }) => {
        if (this._fallback) return;
        console.error("[IpcAudio] Rust decode error:", payload);
        this._fire("error");
      });
    });
  }

  // ── Fallback probe ──────────────────────────────────────────────────────────
  // Calls audio_set_volume (side-effect-free) to check if the Rust command
  // exists.  If it fails with "unknown command", switch to HTML5 Audio.
  _probe(invoke) {
    if (this._probePromise) return this._probePromise;
    // Use audio_pause as a harmless no-op probe — it does nothing when no song
    // is playing, and importantly does NOT touch volume state.
    this._probePromise = invoke("audio_pause")
      .then(() => {
        this._fallback = false;
        console.log("[IpcAudio] Rust audio commands available ✓");
        // Now sync the stored volume to Rust so it's ready for first play
        invoke("audio_set_volume", { volume: this._volume });
      })
      .catch(() => {
        console.warn("[IpcAudio] Rust audio commands not found — falling back to HTML5 Audio");
        this._fallback = this._createFallbackAudio();
        if (this._src) this._fallback.src = this._src;
        this._fallback.volume = this._volume;
      });
    return this._probePromise;
  }

  _createFallbackAudio() {
    const a = new Audio();
    // Wire native events → our listener system
    for (const evt of ["timeupdate", "ended", "loadedmetadata", "canplay", "error", "volumechange"]) {
      a.addEventListener(evt, () => this._fire(evt));
    }
    return a;
  }

  // ── Private helpers ────────────────────────────────────────────────────────
  _cmd(name, args) {
    if (this._fallback) return Promise.resolve(); // Rust path disabled
    console.log("[IpcAudio] →", name, args?.url ? args.url.substring(0, 80) + "…" : "");
    const go = (invoke) => invoke(name, args || {}).catch(e => console.error("[IpcAudio] ERROR", name, e));
    if (this._invoke) { go(this._invoke); }
    else { import("@tauri-apps/api/core").then(({ invoke }) => { this._invoke = invoke; go(invoke); }); }
    return Promise.resolve();
  }

  _fire(type) {
    (this._listeners[type] || []).forEach(h => { try { h({ type }); } catch (e) { console.error(e); } });
  }

  // ── HTMLAudioElement-compatible API ────────────────────────────────────────
  // _fb() returns the fallback Audio if active, or false/null.
  // null = probe still running (undecided), false = Rust is active, Audio = fallback
  get _fb() { return this._fallback; }

  get src() { return this._fb ? this._fb.src : this._src; }
  set src(url) {
    // Always store locally so we can replay onto fallback if probe hasn't finished
    this._src = url;
    this._srcDirty = true;
    this._pendingSeekTo = 0;
    if (this._fb) { this._fb.src = url; }
    else if (this._fb === null && this._probePromise) {
      // Probe still running — queue replay
      this._probePromise.then(() => { if (this._fb) this._fb.src = url; });
    }
  }

  get currentTime() { return this._fb ? this._fb.currentTime : this._currentTime; }
  set currentTime(t) {
    if (this._fb) { this._fb.currentTime = t; return; }
    this._currentTime = t;
    if (this._srcDirty) {
      this._pendingSeekTo = t;
    } else {
      this._cmd("audio_seek", { position: t });
    }
  }

  get duration() { return this._fb ? this._fb.duration : this._duration; }
  get paused()   { return this._fb ? this._fb.paused   : this._paused; }

  get volume() { return this._fb ? this._fb.volume : this._volume; }
  set volume(v) {
    this._volume = v; // always store for probe replay
    if (this._fb) { this._fb.volume = v; this._fire("volumechange"); return; }
    this._cmd("audio_set_volume", { volume: v });
    this._fire("volumechange");
  }

  play() {
    // If probe hasn't resolved yet, wait for it then play
    if (this._fallback === null && this._probePromise) {
      return this._probePromise.then(() => this.play());
    }
    if (this._fb) return this._fb.play();
    if (this._srcDirty && this._src) {
      this._srcDirty = false;
      const seekTo = this._pendingSeekTo;
      this._pendingSeekTo = 0;
      this._paused = false;
      console.log("[IpcAudio] play() → audio_play (new src)");
      this._cmd("audio_play", { url: this._src, seekTo });
    } else {
      this._paused = false;
      console.log("[IpcAudio] play() → audio_resume");
      this._cmd("audio_resume");
    }
    return Promise.resolve();
  }

  pause() {
    if (this._fb) { this._fb.pause(); return; }
    this._paused = true;
    this._cmd("audio_pause");
  }

  addEventListener(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(h => h !== handler);
  }
}

function ExplicitBadge() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--text-muted)", color: "var(--bg-primary)",
      borderRadius: 3, fontSize: 9, fontWeight: 700, padding: "1px 4px",
      letterSpacing: "0.05em", flexShrink: 0, lineHeight: 1.2, userSelect: "none",
    }}>E</span>
  );
}

function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState(null);

  useEffect(() => {
    let cancel = false;
    const check = () => appWindow.isMaximized().then(v => { if (!cancel) setMaximized(v); });
    check();
    const unlisten = appWindow.onResized(() => check());
    return () => { cancel = true; unlisten.then(fn => fn()); };
  }, []);

  const btnBase = {
    background: "none", border: "none", cursor: "pointer",
    width: 36, height: 28, borderRadius: 5,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, transition: "background 0.12s",
    color: "rgba(255,255,255,0.75)",
  };

  const buttons = [
    {
      id: "min",
      action: () => appWindow.minimize(),
      hover: "rgba(255,255,255,0.10)",
      icon: (
        <Minus size={10} />
      ),
    },
    {
      id: "max",
      action: () => appWindow.toggleMaximize(),
      hover: "rgba(255,255,255,0.10)",
      icon: maximized ? (
        // Restore icon — two overlapping squares
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="2" y="0" width="8" height="8" rx="0.5"/>
          <path d="M0 2v7a1 1 0 0 0 1 1h7" />
        </svg>
      ) : (
        // Maximize icon — single square
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="0.5" y="0.5" width="9" height="9" rx="0.5"/>
        </svg>
      ),
    },
    {
      id: "close",
      action: () => appWindow.close(),
      hover: "#c42b1c",
      icon: (
        <X size={10} />
      ),
    },
  ];

  return (
    <div style={{
      height: 32, display: "flex", alignItems: "center",
      justifyContent: "flex-end", padding: "0 8px",
      position: "fixed", top: 4, left: 0, right: 0, zIndex: 9998,
      pointerEvents: "none",
    }}>
      <div data-tauri-drag-region style={{
        position: "absolute", top: 0, left: 80, right: 80, bottom: 0,
        pointerEvents: "all",
      }} />
      <div style={{ display: "flex", gap: 2, position: "relative", pointerEvents: "all" }}>
        {buttons.map(btn => (
          <button
            key={btn.id}
            onClick={e => { e.stopPropagation(); btn.action(); }}
            onMouseEnter={() => setHoveredBtn(btn.id)}
            onMouseLeave={() => setHoveredBtn(null)}
            style={{
              ...btnBase,
              background: hoveredBtn === btn.id ? btn.hover : "none",
              color: hoveredBtn === btn.id && btn.id === "close" ? "#fff" : "rgba(255,255,255,0.75)",
            }}
          >{btn.icon}</button>
        ))}
      </div>
    </div>
  );
}

function formatDuration(str) {
  if (!str) return "—";
  return str;
}

/** Returns {left, top} clamped so the menu (w×h px) stays within the viewport. */
function clampMenu(x, y, w = 220, h = 320) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: x + w > vw ? Math.max(4, x - w) : x,
    top:  y + h > vh ? Math.max(4, y - h) : y,
  };
}

function TrackRow({ track, isPlaying, onPlay, onOpenArtist, onContextMenu }) {
  const anim = useAnimations();
  return (
    <div
      onClick={() => onPlay(track)}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, track); } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 16px", borderRadius: "var(--radius)", cursor: "pointer",
        background: isPlaying ? "rgba(224,64,251,0.08)" : "transparent",
        transition: "background 0.15s",
      }}
      onMouseEnter={e => { if (!isPlaying) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (!isPlaying) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 6, flexShrink: 0,
        background: "var(--bg-elevated)", overflow: "hidden", position: "relative",
        transition: anim ? spring("transform", { stiffness: "0.3s" }) : "none",
      }}>
        {track.thumbnail
          ? <img src={thumb(track.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
        {isPlaying && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}>
            {anim ? (
              // Animated equalizer bars
              [1,2,3].map(b => (
                <div key={b} style={{
                  width: 3, borderRadius: 2, background: "var(--accent)",
                  animation: `eqBar${b} ${0.6 + b * 0.15}s ease-in-out infinite`,
                  animationDelay: `${b * 0.1}s`,
                }} />
              ))
            ) : (
              <Pause size={15} style={{ color: "var(--accent)" }} />
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{
          fontSize: "var(--t13)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, overflow: "hidden",
          color: isPlaying ? "var(--accent)" : "var(--text-primary)",
          transition: anim ? "color 0.2s ease" : "none",
        }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{track.title}</span>
          {track.isExplicit && <ExplicitBadge />}
        </div>
        <div style={{ fontSize: "var(--t12)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {onOpenArtist && track.artistBrowseId ? (
            <span
              onClick={e => { e.stopPropagation(); onOpenArtist({ browseId: track.artistBrowseId, artist: track.artists }); }}
              style={{ cursor: "pointer", transition: anim ? "color 0.15s" : "none" }}
              onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
              onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary)"}
            >{track.artists}</span>
          ) : track.artists}
          {track.album ? ` · ${track.album}` : ""}
        </div>
      </div>
      <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", flexShrink: 0 }}>
        {formatDuration(track.duration)}
      </div>
    </div>
  );
}

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 56;

function Sidebar({ view, setView, onSearch, collapsed, onToggleCollapse, onOpenSettings, onOpenUpdateTab, onCloseOverlay, onOpenPlaylist, onOpenAlbum, onOpenArtist, onAddRecent, onContextMenu, currentProfileData, onOpenProfileSwitcher, profiles, onSwitchProfile, onAddProfile, onDeleteProfile, onCreatePlaylist, updateInfo, offlineMode, isActuallyOffline, onToggleOffline }) {
  const [query, setQuery] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [tetoVisible, setTetoVisible] = useState(false);
  const [tetoLeaving, setTetoLeaving] = useState(false);
  const tetoTimerRef = useRef(null);
  const profileTriggerRef = useRef(null);
  const t = useLang();
  const [pinnedPlaylists, setPinnedPlaylists] = useState([]);
  const [recentPlaylists, setRecentPlaylists] = useState([]);
  const anim = useAnimations();

  const reloadFromStorage = useCallback((prof) => {
    const p = prof || window.__activeProfile || "default";
    try { setPinnedPlaylists(JSON.parse(localStorage.getItem(`kiyoshi-pinned-${p}`) || "[]")); } catch { setPinnedPlaylists([]); }
    try { setRecentPlaylists(JSON.parse(localStorage.getItem(`kiyoshi-recent-${p}`) || "[]")); } catch { setRecentPlaylists([]); }
  }, []);

  // Load once profile is known
  useEffect(() => {
    if (currentProfileData?.name) reloadFromStorage(currentProfileData.name);
  }, [currentProfileData?.name, reloadFromStorage]);

  // Re-sync when pins/recents change from outside (e.g. Library context menu, profile switch)
  useEffect(() => {
    const sync = () => reloadFromStorage();
    window.addEventListener("kiyoshi-pins-updated", sync);
    window.addEventListener("kiyoshi-recent-updated", sync);
    window.addEventListener("profile-switched", sync);
    return () => {
      window.removeEventListener("kiyoshi-pins-updated", sync);
      window.removeEventListener("kiyoshi-recent-updated", sync);
      window.removeEventListener("profile-switched", sync);
    };
  }, [reloadFromStorage]);

  const sidebarItemId = (pl) => pl.playlistId || pl.browseId;
  const isPinned = (pl) => pinnedPlaylists.some(p => sidebarItemId(p) === sidebarItemId(pl));
  const openItem = (pl) => { if (pl.type === "album") onOpenAlbum?.(pl); else if (pl.type === "artist") onOpenArtist?.(pl); else onOpenPlaylist(pl); };

  useEffect(() => {
    if (tetoVisible && !query.toLowerCase().includes("teto")) hideTeto();
  }, [query]);

  const hideTeto = () => {
    setTetoLeaving(true);
    clearTimeout(tetoTimerRef.current);
    tetoTimerRef.current = setTimeout(() => { setTetoVisible(false); setTetoLeaving(false); }, 450);
  };

  const handleKey = e => {
    if (e.key === "Enter" && query.trim()) {
      onSearch(query.trim());
      setView("search");
      onCloseOverlay?.();
      if (query.trim().toLowerCase().includes("teto")) {
        clearTimeout(tetoTimerRef.current);
        setTetoLeaving(false);
        setTetoVisible(true);
      } else if (tetoVisible) {
        hideTeto();
      }
    }
  };

  const mainNavItems = [
    { id: "home",    label: t("home"),    iconEl: <House size={16} /> },
    { id: "library", label: t("library"), iconEl: <Books size={16} /> },
  ];

  const secondaryNavItems = [
    { id: "liked",     label: t("likedSongs"), iconEl: <Heart size={16} /> },
    { id: "history",   label: t("history"),    iconEl: <ClockCounterClockwise size={16} /> },
    { id: "downloads", label: t("downloads"),  iconEl: <DownloadSimple size={16} /> },
  ];

  return (
    <div style={{
      width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      minWidth: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
      background: "var(--bg-surface)", display: "flex", flexDirection: "column",
      padding: "16px 0 0", flexShrink: 0, borderRight: "0.5px solid var(--border)",
      height: "100%", overflow: "hidden",
    }}>
      {/* Fixed tooltip rendered via portal-like state */}
      {tooltip && (
        <div style={{
          position: "fixed", left: tooltip.x, top: tooltip.y, transform: "translateY(-50%)",
          background: "var(--bg-elevated)", color: "var(--text-primary)",
          padding: "4px 10px", borderRadius: 6, fontSize: "var(--t12)", whiteSpace: "nowrap",
          border: "0.5px solid var(--border)", pointerEvents: "none",
          zIndex: 9999, boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>{tooltip.text}</div>
      )}

      {/* Header: toggle button always visible, logo only when expanded */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px 16px",
      }}>
        <div
          onClick={onToggleCollapse}
          onMouseEnter={e => {
            e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)";
            if (collapsed) {
              const r = e.currentTarget.getBoundingClientRect();
              setTooltip({ text: t("expand"), x: r.right + 10, y: r.top + r.height / 2 });
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)";
            setTooltip(null);
          }}
          style={{
            width: 28, height: 28, borderRadius: "var(--radius)", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--text-secondary)", background: "transparent",
            transition: "all 0.15s", position: "relative", zIndex: 201,
          }}
        >
          {collapsed ? <CaretLineRight size={16} /> : <CaretLineLeft size={16} />}
        </div>
        {!collapsed && (
          <>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#logo_grad)"/>
                <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
                <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
                <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
                <defs>
                  <linearGradient id="logo_grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/>
                  </linearGradient>
                </defs>
              </svg>
              {/* Alpha badge */}

            </div>
            <span style={{ fontSize: "var(--t15)", fontWeight: 500, whiteSpace: "nowrap" }}>Music</span>
          </>
        )}
      </div>

      {/* Search (only expanded) */}
      {!collapsed && (
        <div style={{ padding: "0 12px", marginBottom: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(0,0,0,0.25)", borderRadius: "var(--radius)",
            padding: "6px 10px"
          }}>
            <MagnifyingGlass size={16} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder={t("search")}
              style={{
                background: "none", border: "none", outline: "none", color: "var(--text-primary)",
                fontSize: "var(--t13)", width: "100%", fontFamily: "var(--font)"
              }}
            />
            {query && <div onClick={() => setQuery("")} style={{ cursor: "pointer", color: "var(--text-muted)", lineHeight: 1 }}>✕</div>}
          </div>
        </div>
      )}

      {/* Main nav items */}
      {[...mainNavItems, ...secondaryNavItems].map((item, idx) => (
        <React.Fragment key={item.id}>
          {/* Divider before secondary items */}
          {idx === mainNavItems.length && (
            <div style={{ margin: "8px 16px", borderTop: "0.5px solid var(--border)" }} />
          )}
          <div
            onClick={() => {
                setView(item.id);
                onCloseOverlay?.();
                if (anim) { /* brief pop on click */ }
              }}
            onMouseEnter={e => {
              if (view !== item.id) e.currentTarget.style.background = "var(--bg-hover)";
              if (collapsed && item.label) {
                const r = e.currentTarget.getBoundingClientRect();
                setTooltip({ text: item.label, x: r.right + 10, y: r.top + r.height / 2 });
              }
            }}
            onMouseLeave={e => {
              if (view !== item.id) e.currentTarget.style.background = "transparent";
              setTooltip(null);
            }}
            style={{
              display: "flex", alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: 10, padding: collapsed ? "10px 0" : "8px 12px",
              margin: collapsed ? "2px 6px" : "0 8px",
              borderRadius: "var(--radius)", cursor: "pointer",
              color: view === item.id ? "var(--accent)" : "var(--text-secondary)",
              background: view === item.id ? "rgba(224,64,251,0.08)" : "transparent",
              transition: anim
                ? `background 0.15s, color 0.15s, transform 0.22s cubic-bezier(0.34,1.56,0.64,1)`
                : "background 0.15s, color 0.15s",
              fontSize: "var(--t13)",
            }}
          >
            <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{item.iconEl}</span>
            {!collapsed && item.label}
          </div>
        </React.Fragment>
      ))}


      {/* Playlist section */}
      {!collapsed && (pinnedPlaylists.length > 0 || recentPlaylists.length > 0) && (
        <div style={{ overflowY: "auto", maxHeight: 240, margin: "4px 0" }}>
          {pinnedPlaylists.length > 0 && (
            <>
              <div style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "6px 20px 4px" }}>{t("pinned")}</div>
              {pinnedPlaylists.map(pl => (
                <div key={sidebarItemId(pl)}
                  onClick={() => { openItem(pl); onCloseOverlay?.(); }}
                  onContextMenu={e => onContextMenu?.(e, pl)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", margin: "0 8px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t12)", color: "var(--text-secondary)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  {pl.type === "album"
                    ? <VinylRecord size={14} style={{ flexShrink: 0, color: "var(--accent)" }} />
                    : pl.type === "artist"
                    ? <Microphone size={14} style={{ flexShrink: 0, color: "var(--accent)" }} />
                    : <Playlist size={14} style={{ flexShrink: 0, color: "var(--accent)" }} />
                  }
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</span>
                </div>
              ))}
            </>
          )}
          {recentPlaylists.filter(pl => !isPinned(pl)).length > 0 && (
            <>
              <div style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "6px 20px 4px" }}>{t("recentlyOpened")}</div>
              {recentPlaylists.filter(pl => !isPinned(pl)).map(pl => (
                <div key={sidebarItemId(pl)}
                  onClick={() => { openItem(pl); onCloseOverlay?.(); }}
                  onContextMenu={e => onContextMenu?.(e, pl)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", margin: "0 8px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t12)", color: "var(--text-secondary)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  {pl.type === "album"
                    ? <VinylRecord size={14} style={{ flexShrink: 0, opacity: 0.4 }} />
                    : pl.type === "artist"
                    ? <Microphone size={14} style={{ flexShrink: 0, opacity: 0.4 }} />
                    : <Playlist size={14} style={{ flexShrink: 0, opacity: 0.4 }} />
                  }
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* New Playlist button */}
      {!collapsed && (
        <div
          onClick={onCreatePlaylist}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 20px",
            fontSize: "var(--t12)", color: "var(--text-muted)", cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <Plus size={14} weight="bold" />
          <span>{t("newPlaylist")}</span>
        </div>
      )}

      {/* User info + settings */}
      {!collapsed && (
        <div style={{ marginTop: "auto", position: "relative" }}>
          {profileDropdownOpen && profiles && (
            <ProfileSwitcher
              profiles={profiles}
              currentProfile={currentProfileData?.name}
              onSwitch={(name) => { onSwitchProfile(name); setProfileDropdownOpen(false); }}
              onAdd={() => { setProfileDropdownOpen(false); onAddProfile(); }}
              onDelete={(name) => { onDeleteProfile(name); }}
              onClose={() => setProfileDropdownOpen(false)}
              triggerRef={profileTriggerRef}
            />
          )}
          <div style={{ margin: "0 16px 4px", borderTop: "0.5px solid var(--border)" }} />
          <div ref={profileTriggerRef}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", margin: "0 8px 4px", borderRadius: "var(--radius)", cursor: "pointer", transition: "background 0.15s", background: "transparent" }}
            onClick={() => setProfileDropdownOpen(o => !o)}
            onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <div
              style={{
                width: 28, height: 28, borderRadius: "50%", background: "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "var(--t11)", fontWeight: 500, flexShrink: 0,
                overflow: "hidden",
              }}>
              {currentProfileData?.avatar
                ? <img src={thumb(currentProfileData.avatar)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (currentProfileData?.displayName || "?")[0].toUpperCase()}
            </div>
            <div style={{ overflow: "hidden", flex: 1 }}>
              <div style={{ fontSize: "var(--t12)", fontWeight: 500, whiteSpace: "nowrap" }}>{currentProfileData?.displayName || t("noProfile")}</div>
              <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t("switchProfile")}</div>
            </div>
            <CaretUp size={12} style={{ color: "var(--text-muted)", flexShrink: 0, transform: profileDropdownOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s" }} />
          </div>
          {updateInfo && (
            <div onClick={onOpenUpdateTab} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 12px", margin: "0 8px 2px",
              borderRadius: "var(--radius)", cursor: "pointer",
              background: "rgba(224,64,251,0.08)", color: "var(--accent)",
              fontSize: "var(--t12)", fontWeight: 500, transition: "all 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(224,64,251,0.15)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(224,64,251,0.08)"}
            >
              <ArrowCircleUp size={15} />
              {t("updateAvailable")}
            </div>
          )}
          <div
            onClick={onOpenSettings}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", margin: "0 8px 2px",
              borderRadius: "var(--radius)", cursor: "pointer",
              color: "var(--text-secondary)", background: "transparent",
              transition: "all 0.15s", fontSize: "var(--t13)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <Gear size={16} style={{ flexShrink: 0 }} />
            {t("settings")}
          </div>
          {/* Offline toggle — disabled until offline mode is fully implemented */}
          <div
            title={isActuallyOffline ? t("offlineBanner") : t("offlineComingSoon")}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", margin: "0 8px 8px",
              borderRadius: "var(--radius)", cursor: "default",
              color: isActuallyOffline ? "#f0b429" : "var(--text-muted)",
              opacity: isActuallyOffline ? 1 : 0.45,
              transition: "all 0.15s", fontSize: "var(--t13)",
            }}
          >
            {isActuallyOffline ? <WifiX size={16} style={{ flexShrink: 0 }} /> : <WifiHigh size={16} style={{ flexShrink: 0 }} />}
            {isActuallyOffline ? t("offlineBanner") : t("goOffline")}
          </div>
        </div>
      )}
      {collapsed && (
        <div style={{ marginTop: "auto" }}>
          <div style={{ margin: "0 16px 4px", borderTop: "0.5px solid var(--border)" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0 8px" }}>
          <div onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTooltip({ text: "Kiyoshi", x: r.right + 10, y: r.top + r.height / 2 }); }} onMouseLeave={() => setTooltip(null)} style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--t11)", fontWeight: 500 }}>K</div>
          {updateInfo && (
            <div onClick={onOpenUpdateTab}
              onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTooltip({ text: t("updateAvailable"), x: r.right + 10, y: r.top + r.height / 2 }); }}
              onMouseLeave={() => setTooltip(null)}
              style={{
                width: 36, height: 36, borderRadius: "var(--radius)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--accent)", background: "rgba(224,64,251,0.08)",
              }}
            >
              <ArrowCircleUp size={16} />
            </div>
          )}
          <div
            onClick={onOpenSettings}
            onMouseEnter={e => {
              e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)";
              const r = e.currentTarget.getBoundingClientRect(); setTooltip({ text: t("settings"), x: r.right + 10, y: r.top + r.height / 2 });
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)";
              setTooltip(null);
            }}
            style={{
              width: 36, height: 36, borderRadius: "var(--radius)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-secondary)", background: "transparent", transition: "all 0.15s",
            }}
          >
            <Gear size={16} />
          </div>
          <div
            onMouseEnter={e => {
              const r = e.currentTarget.getBoundingClientRect();
              setTooltip({ text: isActuallyOffline ? t("offlineBanner") : t("offlineComingSoon"), x: r.right + 10, y: r.top + r.height / 2 });
            }}
            onMouseLeave={() => setTooltip(null)}
            style={{
              width: 36, height: 36, borderRadius: "var(--radius)", cursor: "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: isActuallyOffline ? "#f0b429" : "var(--text-muted)",
              opacity: isActuallyOffline ? 1 : 0.45, transition: "all 0.15s",
            }}
          >
            {(offlineMode || isActuallyOffline) ? <WifiX size={16} /> : <WifiHigh size={16} />}
          </div>
          </div>
        </div>
      )}
      {/* 🎵 Easter Egg: Kasane Teto */}
      {tetoVisible && createPortal(
        <img
          src="/teto.gif"
          alt="Kasane Teto"
          style={{
            position: "fixed",
            bottom: 72,
            right: 0,
            width: 180,
            height: 180,
            pointerEvents: "none",
            zIndex: 9500,
            animation: tetoLeaving
              ? "tetoSlideOut 0.45s cubic-bezier(0.4,0,0.2,1) forwards"
              : "tetoSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards",
          }}
        />,
        document.body
      )}
    </div>
  );
}

const ACCENT_PRESETS = [
  { label: "Purple",      value: "#e040fb" },
  { label: "Pink",        value: "#f50057" },
  { label: "Red",         value: "#ff1744" },
  { label: "Orange",      value: "#ff6d00" },
  { label: "Yellow",      value: "#ffd740" },
  { label: "Green",       value: "#00e676" },
  { label: "Teal",        value: "#1de9b6" },
  { label: "Cyan",        value: "#00e5ff" },
  { label: "Blue",        value: "#448aff" },
  { label: "Indigo",      value: "#7c4dff" },
  { label: "White",       value: "#f0f0f0" },
  { label: "Gold",        value: "#ffab40" },
];

// ─── Color picker helpers ──────────────────────────────────────────────────
function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${f(5).toString(16).padStart(2, '0')}${f(3).toString(16).padStart(2, '0')}${f(1).toString(16).padStart(2, '0')}`;
}

function ColorPickerPopover({ value, onChange, onClose, anchorRef, inline = false }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#e040fb";
  const [hue, setHue] = useState(() => hexToHsv(safe).h);
  const [sat, setSat] = useState(() => hexToHsv(safe).s);
  const [val, setVal] = useState(() => hexToHsv(safe).v);
  const [hexInput, setHexInput] = useState(safe);
  const popRef = useRef(null);
  const svRef = useRef(null);
  const hueRef = useRef(null);

  const hueColor = hsvToHex(hue, 1, 1);
  const currentHex = hsvToHex(hue, sat, val);

  // Sync picker when external value changes (e.g. preset clicked)
  useEffect(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    const { h, s, v } = hexToHsv(value);
    setHue(h); setSat(s); setVal(v); setHexInput(value);
  }, [value]);

  // Outside-click only for popover mode
  useEffect(() => {
    if (inline) return;
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && !anchorRef?.current?.contains(e.target))
        onClose?.();
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => document.removeEventListener("mousedown", handler);
  }, [inline, onClose, anchorRef]);

  const moveSv = (e) => {
    const rect = svRef.current.getBoundingClientRect();
    const ns = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nv = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    setSat(ns); setVal(nv);
    onChange(hsvToHex(hue, ns, nv));
  };
  const moveHue = (e) => {
    const rect = hueRef.current.getBoundingClientRect();
    const nh = Math.max(0, Math.min(359, ((e.clientX - rect.left) / rect.width) * 360));
    setHue(nh);
    onChange(hsvToHex(nh, sat, val));
  };

  const wrapStyle = inline ? {
    background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
    borderRadius: 12, padding: 14, width: 220,
    boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
  } : {
    position: "absolute", bottom: "calc(100% + 8px)", right: 0, zIndex: 5000,
    background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
    borderRadius: 12, padding: 14, width: 238,
    boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
  };

  return (
    <div ref={popRef} style={wrapStyle}>
      {/* SV gradient area */}
      <div ref={svRef}
        onPointerDown={e => { svRef.current.setPointerCapture(e.pointerId); moveSv(e); }}
        onPointerMove={e => { if (e.buttons) moveSv(e); }}
        style={{
          width: "100%", height: 148, borderRadius: 8, marginBottom: 10,
          position: "relative", cursor: "crosshair",
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${hueColor})`,
        }}
      >
        <div style={{
          position: "absolute",
          left: `${sat * 100}%`, top: `${(1 - val) * 100}%`,
          transform: "translate(-50%, -50%)",
          width: 13, height: 13, borderRadius: "50%",
          border: "2.5px solid #fff", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }} />
      </div>

      {/* Hue slider */}
      <div ref={hueRef}
        onPointerDown={e => { hueRef.current.setPointerCapture(e.pointerId); moveHue(e); }}
        onPointerMove={e => { if (e.buttons) moveHue(e); }}
        style={{
          width: "100%", height: 12, borderRadius: 6, marginBottom: 12,
          cursor: "pointer", position: "relative",
          background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        }}
      >
        <div style={{
          position: "absolute",
          left: `${(hue / 360) * 100}%`, top: "50%",
          transform: "translate(-50%, -50%)",
          width: 16, height: 16, borderRadius: "50%",
          background: hueColor,
          border: "2.5px solid #fff", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.4)",
          pointerEvents: "none",
        }} />
      </div>

      {/* Preview + Hex input */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: currentHex, flexShrink: 0, border: "0.5px solid rgba(255,255,255,0.12)" }} />
        <input
          value={hexInput}
          onChange={e => {
            const raw = e.target.value;
            setHexInput(raw);
            if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
              const { h: nh, s: ns, v: nv } = hexToHsv(raw);
              setHue(nh); setSat(ns); setVal(nv);
              onChange(raw);
            }
          }}
          style={{
            flex: 1, background: "var(--bg-main)", border: "0.5px solid var(--border)",
            borderRadius: 6, padding: "5px 8px", fontSize: "var(--t12)", fontFamily: "monospace",
            color: "var(--text-primary)", outline: "none",
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function Slider({ min, max, step = 1, value, onChange, onChangeCommit, width = 120 }) {
  const pct = ((value - min) / (max - min)) * 100;
  const sliderRef = useRef(null);

  const handlePointerDown = (e) => {
    e.preventDefault();
    const getVal = (clientX) => {
      const rect = sliderRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + p * (max - min);
      return Math.round(raw / step) * step;
    };
    let lastVal = getVal(e.clientX);
    onChange(lastVal);
    const onMove = (me) => { lastVal = getVal(me.clientX); onChange(lastVal); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onChangeCommit?.(lastVal);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={sliderRef}
      onPointerDown={handlePointerDown}
      onMouseEnter={e => e.currentTarget.querySelector(".slider-bar").style.height = "5px"}
      onMouseLeave={e => e.currentTarget.querySelector(".slider-bar").style.height = "3px"}
      style={{ width, height: 16, display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}
    >
      <div className="slider-bar" style={{ width: "100%", height: 3, background: "var(--slider-track)", borderRadius: 2, overflow: "hidden", transition: "height 0.15s ease", pointerEvents: "none" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 44, height: 24, borderRadius: 7,
      background: value ? "var(--accent)" : "var(--bg-elevated)",
      border: "0.5px solid var(--border)",
      position: "relative", cursor: "pointer",
      transition: "background 0.25s ease-in-out", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        left: value ? 23 : 3,
        width: 18, height: 18, borderRadius: 4, background: "#fff",
        transition: "left 0.25s ease-in-out",
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }} />
    </div>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "0.5px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--t13)", fontWeight: 500 }}>{label}</div>
        {description && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function fmtBytes(b) {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const MAX_CACHE_STEPS = [100, 250, 500, 1000, 2000, 5000, 0]; // 0 = unlimited

function DownloadsTab({ t }) {
  const [mp3Dir, setMp3Dir] = useState(() => localStorage.getItem("kiyoshi-mp3-dir") || "");
  const [maxCacheMb, setMaxCacheMb] = useState(() => {
    const v = localStorage.getItem("kiyoshi-max-cache-mb");
    return v ? parseInt(v, 10) : 0; // 0 = unlimited
  });
  const [songStats, setSongStats] = useState(null);

  useEffect(() => {
    fetch(`${API}/cache/stats`)
      .then(r => r.json())
      .then(d => setSongStats(d.songs || null))
      .catch(() => {});
  }, []);

  const handleChangePath = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: t("changePath"), defaultPath: mp3Dir || undefined });
      if (selected) {
        setMp3Dir(selected);
        localStorage.setItem("kiyoshi-mp3-dir", selected);
      }
    } catch {}
  };

  const handleResetPath = () => {
    setMp3Dir("");
    localStorage.removeItem("kiyoshi-mp3-dir");
  };

  const sliderIndex = MAX_CACHE_STEPS.indexOf(maxCacheMb);
  const handleSlider = (idx) => {
    const val = MAX_CACHE_STEPS[idx];
    setMaxCacheMb(val);
    if (val === 0) localStorage.removeItem("kiyoshi-max-cache-mb");
    else localStorage.setItem("kiyoshi-max-cache-mb", String(val));
  };

  const stepLabel = (v) => {
    if (v === 0) return t("unlimited");
    if (v >= 1000) return `${v / 1000} GB`;
    return `${v} MB`;
  };

  const overLimit = maxCacheMb > 0 && songStats && songStats.size > maxCacheMb * 1024 * 1024;

  return (
    <div>
      {/* Default save path */}
      <div style={{ fontSize: "var(--t11)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: 0.5, marginTop: 24, marginBottom: 10 }}>
        {t("defaultSavePath")}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
        background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)",
        border: "0.5px solid var(--border)", marginBottom: 8,
      }}>
        <DownloadSimple size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: "var(--t12)", color: mp3Dir ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {mp3Dir || t("noPathSet")}
        </div>
        {mp3Dir && (
          <button onClick={handleResetPath} style={{
            padding: "4px 10px", borderRadius: 6, border: "0.5px solid var(--border)",
            background: "transparent", color: "var(--text-secondary)", fontSize: "var(--t11)", cursor: "pointer",
          }}>{t("resetPath")}</button>
        )}
        <button onClick={handleChangePath} style={{
          padding: "4px 12px", borderRadius: 6, border: "0.5px solid var(--border)",
          background: "var(--accent)", color: "#fff", fontSize: "var(--t11)", fontWeight: 500, cursor: "pointer",
        }}>{t("changePath")}</button>
      </div>

      {/* Stats */}
      <div style={{ fontSize: "var(--t11)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: 0.5, marginTop: 24, marginBottom: 10 }}>
        {t("storageUsed")}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
        background: overLimit ? "rgba(255,60,60,0.08)" : "var(--bg-elevated)",
        borderRadius: "var(--radius-lg)", border: `0.5px solid ${overLimit ? "rgba(255,60,60,0.4)" : "var(--border)"}`,
        marginBottom: 8,
      }}>
        <MusicNote size={18} style={{ color: overLimit ? "#ff6b6b" : "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "var(--t13)", fontWeight: 500 }}>
            {songStats ? `${songStats.count} ${t("songsCount")}` : "…"}
          </div>
          <div style={{ fontSize: "var(--t11)", color: overLimit ? "#ff6b6b" : "var(--text-secondary)", marginTop: 2 }}>
            {songStats ? fmtBytes(songStats.size) : "…"}
            {overLimit && ` — ${t("cacheWarning")}`}
          </div>
        </div>
      </div>

      {/* Max cache size slider */}
      <div style={{ fontSize: "var(--t11)", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: 0.5, marginTop: 24, marginBottom: 10 }}>
        {t("maxCacheSize")}
      </div>
      <div style={{ padding: "14px 16px", background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", border: "0.5px solid var(--border)" }}>
        <Slider
          min={0}
          max={MAX_CACHE_STEPS.length - 1}
          step={1}
          value={sliderIndex >= 0 ? sliderIndex : MAX_CACHE_STEPS.length - 1}
          onChange={handleSlider}
          width="100%"
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t10)", color: "var(--text-muted)", marginTop: 8 }}>
          {MAX_CACHE_STEPS.map((v, i) => (
            <span key={i} style={{ fontWeight: i === sliderIndex ? 600 : 400, color: i === sliderIndex ? "var(--accent)" : undefined }}>{stepLabel(v)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CacheTab({ t }) {
  const [stats, setStats] = useState(null);
  const [clearing, setClearing] = useState({}); // { albums: true, ... }
  const [cleared, setCleared] = useState({});
  const [fetchError, setFetchError] = useState(null);
  const load = useCallback(() => {
    fetch(`${API}/cache/stats`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`); return r.json(); })
      .then(data => { setStats(data); setFetchError(null); })
      .catch(e => setFetchError(e.message || String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = (cat, val) => {
    setStats(s => s ? { ...s, [cat]: { ...s[cat], enabled: val } } : s);
    fetch(`${API}/cache/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [cat]: val }),
    }).catch(() => {});
  };

  const clear = async (cat) => {
    setClearing(c => ({ ...c, [cat]: true }));
    await fetch(`${API}/cache/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat }),
    }).catch(() => {});
    setClearing(c => ({ ...c, [cat]: false }));
    setCleared(c => ({ ...c, [cat]: true }));
    setTimeout(() => setCleared(c => ({ ...c, [cat]: false })), 1800);
    load();
  };

  const categories = [
    { key: "songs",     label: t("cacheSongs"),     icon: <MusicNote size={18} /> },
    { key: "lyrics",    label: t("cacheLyrics"),    icon: <Microphone size={18} /> },
    { key: "playlists", label: t("cachePlaylists"), icon: <Queue size={18} /> },
    { key: "albums",    label: t("cacheAlbums"),    icon: <VinylRecord size={18} /> },
    { key: "images",    label: t("cacheImages"),    icon: <ImageSquare size={18} /> },
  ];

  return (
    <div>
      {fetchError && (
        <div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 8, background: "rgba(255,60,60,0.15)", color: "#ff6b6b", fontSize: "var(--t11)" }}>
          Cache-Stats Fehler: {fetchError}
        </div>
      )}
      {categories.map(({ key, label, icon }) => {
        const s = stats?.[key];
        const isClearing = clearing[key];
        const wasCleared = cleared[key];
        return (
          <div key={key} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 0", borderBottom: "0.5px solid var(--border)",
          }}>
            {/* Icon + Label */}
            <div style={{ color: "var(--accent)", flexShrink: 0 }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--t13)", fontWeight: 500 }}>{label}</div>
              <div style={{ fontSize: "var(--t11)", color: "var(--text-secondary)", marginTop: 2 }}>
                {s ? fmtBytes(s.size) : "…"}
                {s?.count != null ? ` · ${s.count} ${key === "images" ? t("cacheFiles") : t("cacheEntries")}` : ""}
              </div>
            </div>
            {/* Toggle */}
            <Toggle value={s?.enabled ?? true} onChange={v => toggleEnabled(key, v)} />
            {/* Clear button */}
            <button onClick={() => clear(key)} disabled={isClearing} style={{
              padding: "5px 12px", borderRadius: 7, border: "0.5px solid var(--border)",
              background: wasCleared ? "rgba(76,175,80,0.15)" : "var(--bg-elevated)",
              color: wasCleared ? "#4caf50" : isClearing ? "var(--text-muted)" : "var(--text-secondary)",
              fontSize: "var(--t11)", fontWeight: 500, cursor: isClearing ? "default" : "pointer",
              transition: "all 0.2s", whiteSpace: "nowrap", minWidth: 64,
            }}>
              {wasCleared ? t("cacheCleared") : isClearing ? "…" : t("cacheClear")}
            </button>
          </div>
        );
      })}
      {/* Clear all */}
      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => categories.forEach(c => clear(c.key))} style={{
          padding: "7px 18px", borderRadius: 8, border: "0.5px solid var(--border)",
          background: "var(--bg-elevated)", color: "var(--text-secondary)",
          fontSize: "var(--t12)", fontWeight: 500, cursor: "pointer", transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
        >
          {t("cacheClearAll")}
        </button>
      </div>
    </div>
  );
}

function CreatePlaylistModal({ onClose, onCreated, t }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("PRIVATE");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/playlist/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description, privacyStatus: privacy }),
      });
      const data = await r.json();
      if (data.ok) {
        window.dispatchEvent(new Event("kiyoshi-library-updated"));
        onCreated?.(data.playlistId, title.trim());
        onClose();
      }
    } catch {}
    setCreating(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9001,
        background: "var(--bg-elevated)", borderRadius: 16, padding: 28, minWidth: 380, maxWidth: 440,
        border: "0.5px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 20 }}>{t("createPlaylist")}</div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: "var(--t11)", fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{t("playlistTitle")} *</div>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8, border: "0.5px solid var(--border)",
              background: "var(--bg-main)", color: "var(--text-primary)", fontSize: "var(--t13)", outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: "var(--t11)", fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{t("playlistDescription")}</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8, border: "0.5px solid var(--border)",
              background: "var(--bg-main)", color: "var(--text-primary)", fontSize: "var(--t13)", outline: "none",
              resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: "var(--t11)", fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{t("playlistPrivacy")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["PRIVATE", t("privacyPrivate")], ["PUBLIC", t("privacyPublic")], ["UNLISTED", t("privacyUnlisted")]].map(([val, label]) => (
              <button key={val} onClick={() => setPrivacy(val)} style={{
                padding: "6px 14px", borderRadius: 8, border: "0.5px solid var(--border)",
                background: privacy === val ? "var(--accent)" : "var(--bg-main)",
                color: privacy === val ? "#fff" : "var(--text-secondary)",
                fontSize: "var(--t12)", fontWeight: 500, cursor: "pointer", transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: 8, border: "0.5px solid var(--border)",
            background: "var(--bg-main)", color: "var(--text-secondary)", fontSize: "var(--t13)", cursor: "pointer",
          }}>{t("cancel")}</button>
          <button onClick={handleCreate} disabled={!title.trim() || creating} style={{
            padding: "8px 18px", borderRadius: 8, border: "none",
            background: !title.trim() ? "var(--text-muted)" : "var(--accent)", color: "#fff",
            fontSize: "var(--t13)", fontWeight: 500, cursor: !title.trim() ? "default" : "pointer",
            opacity: creating ? 0.6 : 1,
          }}>{creating ? t("loadingDots") : t("create")}</button>
        </div>
      </div>
    </>
  );
}

function LyricsProviderList({ providers, onChange }) {
  const [dragOver, setDragOver] = useState(null);
  const isDragging = useRef(false);
  const dragOverRef = useRef(null);
  const listRef = useRef(null);

  const handlePointerDown = (e, fromIdx) => {
    e.preventDefault();
    isDragging.current = false;
    dragOverRef.current = null;
    const startY = e.clientY;

    const onMove = (me) => {
      if (Math.abs(me.clientY - startY) > 4) isDragging.current = true;
      if (!isDragging.current || !listRef.current) return;
      const rows = listRef.current.querySelectorAll("[data-provider-idx]");
      let closest = null, closestDist = Infinity;
      rows.forEach(row => {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(me.clientY - mid);
        if (dist < closestDist) { closestDist = dist; closest = row; }
      });
      if (closest) {
        const idx = parseInt(closest.dataset.providerIdx);
        dragOverRef.current = idx;
        setDragOver(idx);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const target = dragOverRef.current;
      if (isDragging.current && target !== null && target !== fromIdx) {
        const next = [...providers];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(target, 0, moved);
        onChange(next);
      }
      isDragging.current = false;
      dragOverRef.current = null;
      setDragOver(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {providers.map((p, i) => (
        <div
          key={p.id}
          data-provider-idx={i}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: "var(--radius)",
            background: "var(--bg-elevated)",
            border: `0.5px solid ${dragOver === i ? "var(--accent)" : "var(--border)"}`,
            borderTop: dragOver === i ? "2px solid var(--accent)" : undefined,
            transition: "border-color 0.1s",
          }}
        >
          {/* Drag handle */}
          <div
            onPointerDown={e => handlePointerDown(e, i)}
            style={{ cursor: "grab", color: "var(--text-muted)", display: "flex", alignItems: "center", flexShrink: 0, touchAction: "none" }}
          >
            <DotsSixVertical size={16} style={{ pointerEvents: "none" }} />
          </div>
          {/* Label */}
          <span style={{ fontSize: "var(--t13)", color: p.enabled ? "var(--text-primary)" : "var(--text-muted)" }}>{p.label}</span>
          {/* Sync-type tag */}
          {PROVIDER_SYNC[p.id] && (() => {
            const sync = PROVIDER_SYNC[p.id];
            return (
              <span style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: "var(--t10)", whiteSpace: "nowrap", flexShrink: 0,
                padding: "2px 6px", borderRadius: 4,
                background: p.enabled ? sync.bg : "rgba(255,255,255,0.05)",
                color: p.enabled ? sync.color : "var(--text-muted)",
                transition: "all 0.2s",
              }}>
                {sync.icon && <span style={{ display: "inline-block", width: 16, height: 16, flexShrink: 0, alignSelf: "center", backgroundColor: "currentColor", maskImage: `url(${sync.icon})`, WebkitMaskImage: `url(${sync.icon})`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />}
                {sync.label}
              </span>
            );
          })()}
          <div style={{ flex: 1 }} />
          {/* Enable toggle */}
          <Toggle value={p.enabled} onChange={v => onChange(providers.map((x, j) => j === i ? { ...x, enabled: v } : x))} />
        </div>
      ))}
    </div>
  );
}

// ─── Debug shared helpers ────────────────────────────────────────────────────
const _debugLevelColor = (level) => {
  if (level === "ERROR") return "#ff6b6b";
  if (level === "WARN")  return "#f0b429";
  if (level === "INFO")  return "#64b5f6";
  return "var(--text-muted)";
};
const _debugLevelBg = (level) => {
  if (level === "ERROR") return "rgba(255,107,107,0.12)";
  if (level === "WARN")  return "rgba(240,180,41,0.10)";
  if (level === "INFO")  return "rgba(100,181,246,0.08)";
  return "transparent";
};
const _debugFmtTs = (ts) => new Date(ts * 1000).toTimeString().slice(0, 8);
const _debugBtnStyle = (active) => ({
  padding: "3px 9px", borderRadius: 5, border: "0.5px solid var(--border)",
  background: active ? "rgba(224,64,251,0.15)" : "var(--bg-elevated)",
  color: active ? "var(--accent)" : "var(--text-secondary)",
  fontSize: "var(--t11)", cursor: "pointer", transition: "all 0.12s",
  fontFamily: "var(--font)", fontWeight: active ? 600 : 400,
});

function _buildDebugReport(info, logs) {
  return [
    "=== Kiyoshi Music Debug Report ===",
    info ? [
      `App:        ${APP_VERSION}`,
      `Python:     ${info.python}`,
      `yt-dlp:     ${info.ytdlp}`,
      `ytmusicapi: ${info.ytmusicapi}`,
      `Flask:      ${info.flask}`,
      `Node.js:    ${info.node || "—"}`,
      `Profil:     ${info.profile}`,
      `Plattform:  ${info.platform}`,
      `Uptime:     ${info.uptime}`,
      `Data dir:   ${info.data_dir}`,
    ].join("\n") : "Backend nicht erreichbar",
    `\n=== Logs (${logs.length} Einträge) ===`,
    ...logs.map(l => `[${_debugFmtTs(l.ts)}] [${l.level}] [${l.source}] ${l.msg}`),
  ].join("\n");
}

// ─── Debug Floating Window ───────────────────────────────────────────────────
function DebugFloatingWindow({ onClose }) {
  const [info, setInfo]           = useState(null);
  const [filter, setFilter]       = useState("ALL");
  const [source, setSource]       = useState("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState("logs"); // "info" | "logs"
  const [copied, setCopied]       = useState(false);
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem("kiyoshi-debug-float-pos")) || { x: 80, y: 80 }; }
    catch { return { x: 80, y: 80 }; }
  });
  const logRef = useRef(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const fetchInfo = useCallback(() => {
    fetch(`${API}/debug/info`).then(r => r.json()).then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    fetchInfo();
    const id = setInterval(fetchInfo, 3000);
    return () => clearInterval(id);
  }, [fetchInfo]);

  const allLogs = useMemo(() => {
    const backend = info?.logs || [];
    return [..._frontendLogs, ...backend].sort((a, b) => a.ts - b.ts);
  }, [info]);

  const visibleLogs = useMemo(() => allLogs.filter(l => {
    if (filter !== "ALL" && l.level !== filter) return false;
    if (source !== "ALL" && l.source !== source) return false;
    return true;
  }), [allLogs, filter, source]);

  useEffect(() => {
    if (autoScroll && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visibleLogs.length, autoScroll]);

  const startDrag = useCallback((e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const ox = e.clientX - posRef.current.x;
    const oy = e.clientY - posRef.current.y;
    const onMove = (me) => {
      const np = { x: me.clientX - ox, y: me.clientY - oy };
      setPos(np);
      localStorage.setItem("kiyoshi-debug-float-pos", JSON.stringify(np));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(_buildDebugReport(info, visibleLogs))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  };

  const sysRows = info ? [
    ["Python",     info.python],
    ["yt-dlp",     info.ytdlp],
    ["ytmusicapi", info.ytmusicapi],
    ["Flask",      info.flask],
    ["Node.js",    info.node ? info.node.split(/[/\\]/).pop() : "—"],
    ["Profil",     info.profile],
    ["Plattform",  info.platform],
    ["Uptime",     info.uptime],
  ] : [];

  return createPortal(
    <div style={{
      position: "fixed", left: pos.x, top: pos.y, zIndex: 9998,
      width: 660, display: "flex", flexDirection: "column",
      background: "var(--bg-surface)", border: "0.5px solid var(--border)",
      borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.75)",
      fontFamily: "var(--font)", overflow: "hidden",
      resize: "both", minWidth: 380, minHeight: 260,
    }}>
      {/* Title bar */}
      <div onMouseDown={startDrag} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 10px", background: "var(--bg-elevated)",
        borderBottom: "0.5px solid var(--border)",
        cursor: "grab", userSelect: "none", flexShrink: 0,
      }}>
        <Bug size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>Debug</span>
        <button style={_debugBtnStyle(activeTab === "info")}  onClick={() => setActiveTab("info")}>Sysinfo</button>
        <button style={_debugBtnStyle(activeTab === "logs")}  onClick={() => setActiveTab("logs")}>Logs</button>
        <div style={{ width: 1, height: 12, background: "var(--border)", margin: "0 2px" }} />
        <button
          onClick={onClose}
          style={{
            width: 20, height: 20, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "rgba(255,80,80,0.15)", color: "#ff6b6b",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
            transition: "background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,80,80,0.35)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(255,80,80,0.15)"}
        ><X size={10} weight="bold" /></button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "10px 12px", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 200 }}>
        {activeTab === "info" && (
          <div style={{ overflowY: "auto" }}>
            {!info ? (
              <div style={{ color: "var(--text-muted)", fontSize: "var(--t12)", padding: 8 }}>Laden…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                {sysRows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}>
                    <span style={{ fontSize: "var(--t11)", color: "var(--text-muted)", minWidth: 72, flexShrink: 0 }}>{k}</span>
                    <span style={{ fontSize: "var(--t11)", color: "var(--text-primary)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "logs" && (
          <>
            {/* Filter bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, flexWrap: "wrap", flexShrink: 0 }}>
              {["ALL","INFO","WARN","ERROR"].map(f => (
                <button key={f} style={_debugBtnStyle(filter === f)} onClick={() => setFilter(f)}>{f}</button>
              ))}
              <div style={{ width: 1, height: 12, background: "var(--border)", margin: "0 1px" }} />
              {["ALL","frontend","backend"].map(s => (
                <button key={s} style={_debugBtnStyle(source === s)} onClick={() => setSource(s)}>{s === "ALL" ? "Alle" : s}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button style={{ ..._debugBtnStyle(autoScroll), display: "flex", alignItems: "center", gap: 3 }} onClick={() => setAutoScroll(a => !a)}>
                  <CaretDown size={10} /> Scroll
                </button>
                <button style={{ ..._debugBtnStyle(false), display: "flex", alignItems: "center", gap: 3 }} onClick={handleCopy}>
                  {copied ? <><Check size={10} weight="bold" /> Kopiert!</> : <><Copy size={10} /> Kopieren</>}
                </button>
              </div>
            </div>

            {/* Log list */}
            <div ref={logRef} style={{
              flex: 1, overflowY: "auto", background: "var(--bg-elevated)",
              border: "0.5px solid var(--border)", borderRadius: 7,
              padding: "4px 2px", fontFamily: "monospace", fontSize: 10, minHeight: 0,
            }}
              onScroll={e => {
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight > 40 && autoScroll) setAutoScroll(false);
              }}
            >
              {visibleLogs.length === 0
                ? <div style={{ color: "var(--text-muted)", padding: "10px 8px", textAlign: "center" }}>Keine Einträge.</div>
                : visibleLogs.map((entry, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 5, padding: "1px 5px",
                    borderRadius: 3, marginBottom: 1, background: _debugLevelBg(entry.level),
                  }}>
                    <span style={{ color: "var(--text-muted)", flexShrink: 0, userSelect: "none" }}>{_debugFmtTs(entry.ts)}</span>
                    <span style={{ color: _debugLevelColor(entry.level), flexShrink: 0, minWidth: 36, fontWeight: 700, userSelect: "none" }}>{entry.level}</span>
                    <span style={{ color: entry.source === "frontend" ? "rgba(224,64,251,0.7)" : "rgba(100,181,246,0.6)", flexShrink: 0, minWidth: 50, userSelect: "none" }}>[{entry.source}]</span>
                    <span style={{ color: "var(--text-secondary)", wordBreak: "break-all", lineHeight: 1.4 }}>{entry.msg}</span>
                  </div>
                ))
              }
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Debug Tab ───────────────────────────────────────────────────────────────
function DebugTab({ t }) {
  const [info, setInfo]           = useState(null);
  const [error, setError]         = useState(null);
  const [filter, setFilter]       = useState("ALL");
  const [source, setSource]       = useState("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied]       = useState(false);
  const logRef = useRef(null);

  const fetchInfo = useCallback(() => {
    setError(null);
    fetch(`${API}/debug/info`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setInfo).catch(e => setError(e.message));
  }, []);
  useEffect(() => { fetchInfo(); }, [fetchInfo, refreshKey]);

  const allLogs = useMemo(() => {
    return [..._frontendLogs, ...(info?.logs || [])].sort((a, b) => a.ts - b.ts);
  }, [info]);
  const visibleLogs = useMemo(() =>
    allLogs.filter(l => (filter === "ALL" || l.level === filter) && (source === "ALL" || l.source === source)),
  [allLogs, filter, source]);
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visibleLogs.length, autoScroll]);

  const handleCopy = () => {
    navigator.clipboard.writeText(_buildDebugReport(info, visibleLogs))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  const openFloat = () => window.dispatchEvent(new CustomEvent("kiyoshi-debug-float"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* System Info */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: "var(--t11)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("debugSysInfo")}</div>
          <button
            onClick={openFloat}
            style={{ ..._debugBtnStyle(false), display: "flex", alignItems: "center", gap: 5, padding: "4px 10px" }}
            title={t("debugOpenFloat")}
          >
            <ArrowSquareOut size={12} />
            {t("debugOpenFloat")}
          </button>
        </div>
        {error ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,60,60,0.12)", color: "#ff6b6b", fontSize: "var(--t12)", display: "flex", alignItems: "center", gap: 8 }}>
            <X size={14} weight="bold" /> {t("debugBackendUnreachable")}: {error}
          </div>
        ) : !info ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: "var(--t12)" }}>{t("loading")}…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              ["Python",     info.python],
              ["yt-dlp",     info.ytdlp],
              ["ytmusicapi", info.ytmusicapi],
              ["Flask",      info.flask],
              ["Node.js",    info.node ? <span style={{ color: "#4caf50", display: "flex", alignItems: "center", gap: 4 }}><Check size={11} weight="bold" />{info.node.split(/[/\\]/).pop()}</span> : <span style={{ color: "#ff6b6b" }}>—</span>],
              ["Profil",     info.profile],
              ["Plattform",  info.platform],
              ["Uptime",     info.uptime],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}>
                <span style={{ fontSize: "var(--t11)", color: "var(--text-muted)", minWidth: 76, flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: "var(--t12)", color: "var(--text-primary)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Log viewer */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--t11)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 4 }}>Logs</span>
          {["ALL","INFO","WARN","ERROR"].map(f => (
            <button key={f} style={_debugBtnStyle(filter === f)} onClick={() => setFilter(f)}>{f}</button>
          ))}
          <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 2px" }} />
          {["ALL","frontend","backend"].map(s => (
            <button key={s} style={_debugBtnStyle(source === s)} onClick={() => setSource(s)}>{s === "ALL" ? "Alle" : s}</button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button style={{ ..._debugBtnStyle(autoScroll), display: "flex", alignItems: "center", gap: 4 }} onClick={() => setAutoScroll(a => !a)}>
              <CaretDown size={11} /> Auto-Scroll
            </button>
            <button style={{ ..._debugBtnStyle(false), display: "flex", alignItems: "center", gap: 4 }} onClick={() => setRefreshKey(k => k + 1)}>
              <ArrowClockwise size={11} /> {t("refresh")}
            </button>
            <button style={{ ..._debugBtnStyle(false), display: "flex", alignItems: "center", gap: 4 }} onClick={handleCopy}>
              {copied ? <><Check size={11} weight="bold" /> {t("copied")}</> : <><Copy size={11} /> {t("copyAll")}</>}
            </button>
          </div>
        </div>
        <div ref={logRef} style={{
          flex: 1, overflowY: "auto", background: "var(--bg-elevated)",
          border: "0.5px solid var(--border)", borderRadius: 8,
          padding: "6px 4px", fontFamily: "monospace", fontSize: "var(--t11)", minHeight: 180,
        }}
          onScroll={e => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight > 40 && autoScroll) setAutoScroll(false); }}
        >
          {visibleLogs.length === 0
            ? <div style={{ color: "var(--text-muted)", padding: "12px 8px", textAlign: "center" }}>{t("debugNoLogs")}</div>
            : visibleLogs.map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "2px 6px", borderRadius: 4, marginBottom: 1, background: _debugLevelBg(entry.level) }}>
                <span style={{ color: "var(--text-muted)", flexShrink: 0, userSelect: "none" }}>{_debugFmtTs(entry.ts)}</span>
                <span style={{ color: _debugLevelColor(entry.level), flexShrink: 0, minWidth: 38, fontWeight: 700, userSelect: "none" }}>{entry.level}</span>
                <span style={{ color: entry.source === "frontend" ? "rgba(224,64,251,0.7)" : "rgba(100,181,246,0.6)", flexShrink: 0, minWidth: 52, userSelect: "none" }}>[{entry.source}]</span>
                <span style={{ color: "var(--text-secondary)", wordBreak: "break-all", lineHeight: 1.45 }}>{entry.msg}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ onClose, accent, onAccentChange, theme, onThemeChange, animations, onAnimationsChange, lyricsFontSize, onLyricsFontSizeChange, lyricsTranslationFontSize, onLyricsTranslationFontSizeChange, lyricsRomajiFontSize, onLyricsRomajiFontSizeChange, lyricsProviders, onLyricsProvidersChange, autoplay, onAutoplayChange, crossfade, onCrossfadeChange, discordRpc, onDiscordRpcChange, language, onLanguageChange, updateInfo, onCheckUpdate, updateDownloading, updateDownloadProgress, updateDownloaded, onDownloadUpdate, onInstallUpdate, onCancelDownload, initialTab, onTabOpened, hideExplicit, onHideExplicitChange, uiZoom, onUiZoomChange, appFontScale, onFontScaleChange, showRomaji, onToggleRomaji, showAgentTags, onToggleAgentTags, highContrast, onToggleHighContrast, appFont, onAppFontChange, ambientVisualizer, onToggleAmbientVisualizer }) {
  const anim = useAnimations();
  const t = useLang();
  const [tab, setTab] = useState(initialTab || "darstellung");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerTriggerRef = useRef(null);
  useEffect(() => { if (initialTab) { setTab(initialTab); onTabOpened?.(); } }, [initialTab]);
  const chromiumVersion = window.navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "—";

  const navItems = [
    { id: "darstellung",    label: t("appearance"),    iconEl: <PaintBrushBroad size={18} /> },
    { id: "wiedergabe",     label: t("playback"),      iconEl: <Play size={18} /> },
    { id: "lyrics",         label: t("lyrics"),        iconEl: <ChatText size={18} /> },
    { id: "accessibility",  label: t("accessibility"), iconEl: <PersonArmsSpread size={18} /> },
    { id: "shortcuts",   label: t("shortcuts"),   iconEl: <Keyboard size={18} /> },
    { id: "language",    label: t("language"),    iconEl: <Translate size={18} /> },
    { id: "cache",       label: t("cache"),       iconEl: <HardDrives size={18} /> },
    { id: "downloads",  label: t("downloads"),   iconEl: <DownloadSimple size={18} /> },
    { id: "update",     label: t("update"),      iconEl: <ArrowsClockwise size={18} /> },
    { id: "debug",      label: t("debug"),       iconEl: <Bug size={18} /> },
  ];

  const shortcuts = [
    { key: "Leertaste", action: t("scPlayPause") },
    { key: "→",         action: t("scNext") },
    { key: "←",         action: t("scPrev") },
    { key: "↑",         action: t("scVolUp") },
    { key: "↓",         action: t("scVolDown") },
    { key: "F",         action: t("scFullscreen") },
    { key: "Esc",       action: t("scClose") },
    { key: "M",         action: t("scMute") },
    { key: "L",         action: t("scToggleLyrics") },
    { key: ",",         action: t("scSeekBack") },
    { key: ".",         action: t("scSeekForward") },
    { key: "Ctrl + +",  action: t("scZoomIn") },
    { key: "Ctrl + −",  action: t("scZoomOut") },
  ];

  const SectionLabel = ({ children }) => (
    <div style={{ fontSize: "var(--t11)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "24px 0 8px" }}>{children}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", animation: anim ? "fadeIn 0.18s ease" : undefined }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", width: 900, height: 640, maxWidth: "calc(100% - 40px)", maxHeight: "calc(100% - 40px)", display: "flex", boxShadow: "0 32px 80px rgba(0,0,0,0.7)", animation: anim ? "fadeSlideIn 0.28s cubic-bezier(0.34,1.56,0.64,1)" : undefined, border: "0.5px solid var(--border)" }}>

        {/* Left Sidebar */}
        <div style={{ width: 220, background: "var(--bg-elevated)", flexShrink: 0, display: "flex", flexDirection: "column", padding: "20px 12px", borderRight: "0.5px solid var(--border)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 20px" }}>
            <div style={{ position: "relative" }}>
              <svg width="52" height="52" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#slogo_g)"/>
                <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
                <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
                <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
                <defs><linearGradient id="slogo_g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/></linearGradient></defs>
              </svg>
              <div style={{
                position: "absolute", bottom: -4, right: -10,
                background: "var(--accent)", color: "#fff",
                fontSize: 8, fontWeight: 700, letterSpacing: "0.04em",
                padding: "2px 5px", borderRadius: 4, lineHeight: 1.4,
                boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
              }}>Alpha</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ fontSize: "var(--t10)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px 8px" }}>{t("appSettings")}</div>

          {navItems.map(item => (
            <div key={item.id} onClick={() => setTab(item.id)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: "var(--radius)", cursor: "pointer",
              background: tab === item.id ? "rgba(224,64,251,0.12)" : "transparent",
              color: tab === item.id ? "var(--accent)" : "var(--text-secondary)",
              fontSize: "var(--t13)", fontWeight: tab === item.id ? 500 : 400,
              transition: "background 0.15s, color 0.15s", marginBottom: 2,
            }}
            onMouseEnter={e => { if (tab !== item.id) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}}
            onMouseLeave={e => { if (tab !== item.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}}
            >
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{item.iconEl || <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">{item.icon}</svg>}</span>
              {item.label}
              {item.id === "update" && updateInfo && (
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", marginLeft: "auto", flexShrink: 0 }} />
              )}
            </div>
          ))}
          </div>{/* end scrollable nav */}

          <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12 }}>
            <div style={{ padding: "0 8px 12px" }}>
              <div style={{ fontSize: "var(--t11)", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{APP_VERSION}</div>
              <div style={{ fontSize: "var(--t10)", color: "var(--text-muted)", lineHeight: 1.7 }}>
                Tauri 2.10.3<br/>
                Chromium {chromiumVersion}
              </div>
            </div>
            <div onClick={onClose} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: "var(--radius)", cursor: "pointer",
              color: "var(--text-muted)", fontSize: "var(--t13)", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "#f44336"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <X size={16} />
              {t("close")}
            </div>
          </div>
        </div>

        {/* Right Content */}
        <div style={{ flex: 1, background: "var(--bg-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "24px 32px 0", flexShrink: 0 }}>
            <div style={{ fontSize: "var(--t20)", fontWeight: 700, marginBottom: 4 }}>
              {navItems.find(i => i.id === tab)?.label}
            </div>
            <div style={{ height: 1, background: "var(--border)", marginTop: 20 }} />
          </div>

          <div className="scrollable" style={{ flex: 1, overflowY: "auto", padding: "8px 32px 32px" }}>

            {tab === "darstellung" && (
              <>
                <SectionLabel>{t("theme")}</SectionLabel>
                <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                  {[
                    { id: "dark",  label: t("themeDark"),  bg: "#0d0d0d", surface: "#141414", elevated: "#1c1c1c", text: "#f0f0f0" },
                    { id: "oled",  label: t("themeOled"),  bg: "#000000", surface: "#080808", elevated: "#0f0f0f", text: "#ffffff" },
                    { id: "light", label: t("themeLight"), bg: "#f0f0f0", surface: "#ffffff", elevated: "#e4e4e4", text: "#111111" },
                  ].map(th => (
                    <div key={th.id} onClick={() => onThemeChange(th.id)} style={{
                      flex: 1, borderRadius: 10, overflow: "hidden", cursor: "pointer",
                      border: theme === th.id ? `2px solid var(--accent)` : "2px solid var(--border)",
                      transition: anim ? "border-color 0.15s, transform 0.15s" : "border-color 0.15s",
                      transform: theme === th.id && anim ? "scale(1.02)" : "scale(1)",
                    }}
                    onMouseEnter={e => { if (anim) e.currentTarget.style.transform = "scale(1.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = theme === th.id && anim ? "scale(1.02)" : "scale(1)"; }}
                    >
                      {/* Mini preview */}
                      <div style={{ background: th.bg, padding: 10, height: 80 }}>
                        <div style={{ background: th.surface, borderRadius: 6, padding: "6px 8px", marginBottom: 5 }}>
                          <div style={{ width: "60%", height: 5, borderRadius: 3, background: accent, marginBottom: 4 }} />
                          <div style={{ width: "40%", height: 4, borderRadius: 3, background: th.text, opacity: 0.3 }} />
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <div style={{ flex: 1, background: th.elevated, borderRadius: 4, height: 24 }} />
                          <div style={{ flex: 1, background: th.elevated, borderRadius: 4, height: 24 }} />
                        </div>
                      </div>
                      {/* Label */}
                      <div style={{
                        background: th.surface, padding: "7px 10px", fontSize: "var(--t12)", fontWeight: 500,
                        color: theme === th.id ? accent : th.text, textAlign: "center",
                        borderTop: `1px solid ${th.id === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.06)"}`,
                      }}>{th.label}</div>
                    </div>
                  ))}
                </div>

                <SectionLabel>{t("accentColor")}</SectionLabel>
                {(() => {
                  const GAP = 6;
                  const isCustom = !ACCENT_PRESETS.some(p => p.value === accent);
                  return (
                    <div style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 14 }}>
                      {/* Left: preset grid + custom box — stretches to picker height */}
                      <div style={{ display: "flex", gap: GAP, flex: 1, minWidth: 0 }}>
                        {/* Preset grid — fills all available space, 4 cols × 3 rows */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, 1fr)",
                          gridTemplateRows: "repeat(3, 1fr)",
                          gap: GAP, flex: 1,
                        }}>
                          {ACCENT_PRESETS.map(p => (
                            <Tooltip key={p.value} text={p.label}><div onClick={() => onAccentChange(p.value)} style={{
                              borderRadius: 7, background: p.value, cursor: "pointer",
                              transition: anim ? spring("transform") : "none",
                              outline: accent === p.value ? `2.5px solid ${p.value}` : "2.5px solid transparent", outlineOffset: 2,
                            }}
                            onMouseEnter={e => { if (anim) e.currentTarget.style.transform = "scale(1.06)"; }}
                            onMouseLeave={e => { if (anim) e.currentTarget.style.transform = "scale(1)"; }}
                            /></Tooltip>
                          ))}
                        </div>
                        {/* Custom color box — stretches to full grid height */}
                        <Tooltip text={t("customColor")}><div style={{
                          width: 36, flexShrink: 0, borderRadius: 7,
                          background: isCustom ? accent : "var(--bg-elevated)",
                          border: `0.5px solid ${isCustom ? "transparent" : "var(--border)"}`,
                          outline: isCustom ? `2.5px solid ${accent}` : "2.5px solid transparent", outlineOffset: 2,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <PencilSimple size={14} style={{ color: isCustom ? "#fff" : "var(--text-muted)" }} />
                        </div></Tooltip>
                      </div>
                      {/* Right: color picker — always visible inline */}
                      <ColorPickerPopover
                        value={accent}
                        onChange={onAccentChange}
                        inline={true}
                      />
                    </div>
                  );
                })()}
                <SectionLabel>{t("appearance")}</SectionLabel>
                <SettingRow label={t("animations")} description={t("animationsDesc")}>
                  <Toggle value={animations} onChange={onAnimationsChange} />
                </SettingRow>
                <SettingRow label={t("uiZoom")} description={t("uiZoomDesc")}>
                  <div style={{ width: 360 }}>
                    <Slider min={0} max={ZOOM_STEPS.length - 1} step={1}
                      value={Math.max(0, ZOOM_STEPS.indexOf(uiZoom))}
                      onChange={i => onUiZoomChange(ZOOM_STEPS[i])} width={360} />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      {ZOOM_LABELS.map((label, i) => (
                        <span key={i} style={{ fontSize: "var(--t10)", fontWeight: uiZoom === ZOOM_STEPS[i] ? 700 : 400, color: uiZoom === ZOOM_STEPS[i] ? "var(--accent)" : "var(--text-muted)" }}>{label}</span>
                      ))}
                    </div>
                  </div>
                </SettingRow>
                <SettingRow label={t("fontSize")} description={t("fontSizeDesc")}>
                  <div style={{ width: 360 }}>
                    <Slider min={0} max={FONT_STEPS.length - 1} step={1}
                      value={Math.max(0, FONT_STEPS.indexOf(appFontScale))}
                      onChange={i => onFontScaleChange(FONT_STEPS[i])} width={360} />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      {FONT_LABELS.map((label, i) => (
                        <span key={i} style={{ fontSize: "var(--t10)", fontWeight: appFontScale === FONT_STEPS[i] ? 700 : 400, color: appFontScale === FONT_STEPS[i] ? "var(--accent)" : "var(--text-muted)" }}>{label}</span>
                      ))}
                    </div>
                  </div>
                </SettingRow>
              </>
            )}

            {tab === "wiedergabe" && (
              <>
                <SectionLabel>{t("playback")}</SectionLabel>
                <SettingRow label={t("autoplay")} description={t("autoplayDesc")}>
                  <Toggle value={autoplay} onChange={onAutoplayChange} />
                </SettingRow>
                <SettingRow label={t("crossfade")} description={`${t("crossfadeDesc")}: ${crossfade}s`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Slider min={0} max={12} step={1} value={crossfade} onChange={onCrossfadeChange} width={120} />
                    <span style={{ fontSize: "var(--t12)", color: "var(--text-muted)", width: 28 }}>{crossfade}s</span>
                  </div>
                </SettingRow>
                <SettingRow label={t("discordRpc")} description={t("discordRpcDesc")}>
                  <Toggle value={discordRpc} onChange={onDiscordRpcChange} />
                </SettingRow>
                <SettingRow label={t("hideExplicit")} description={t("hideExplicitDesc")}>
                  <Toggle value={hideExplicit} onChange={onHideExplicitChange} />
                </SettingRow>
              </>
            )}

            {tab === "lyrics" && (
              <>
                <SectionLabel>{t("lyrics")}</SectionLabel>
                <SettingRow label={t("fontSize")} description={`${t("fontSizeDesc")}: ${lyricsFontSize}px`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Slider min={18} max={52} step={2} value={lyricsFontSize} onChange={onLyricsFontSizeChange} width={120} />
                    <span style={{ fontSize: "var(--t12)", color: "var(--text-muted)", width: 36 }}>{lyricsFontSize}px</span>
                  </div>
                </SettingRow>
                <SettingRow label={t("translationFontSize")} description={`${t("fontSizeDesc")}: ${lyricsTranslationFontSize}px`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Slider min={12} max={40} step={2} value={lyricsTranslationFontSize} onChange={onLyricsTranslationFontSizeChange} width={120} />
                    <span style={{ fontSize: "var(--t12)", color: "var(--text-muted)", width: 36 }}>{lyricsTranslationFontSize}px</span>
                  </div>
                </SettingRow>
                <SettingRow label={t("showRomaji")} description={t("romajiLyrics")}>
                  <Toggle value={showRomaji} onChange={onToggleRomaji} />
                </SettingRow>
                <SettingRow label={t("showAgentTags")} description={t("showAgentTagsDesc")}>
                  <Toggle value={showAgentTags} onChange={onToggleAgentTags} />
                </SettingRow>
                <SettingRow label={t("romajiFontSize")} description={`${t("fontSizeDesc")}: ${lyricsRomajiFontSize}px`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Slider min={12} max={40} step={2} value={lyricsRomajiFontSize} onChange={onLyricsRomajiFontSizeChange} width={120} />
                    <span style={{ fontSize: "var(--t12)", color: "var(--text-muted)", width: 36 }}>{lyricsRomajiFontSize}px</span>
                  </div>
                </SettingRow>
                <SectionLabel>{t("lyricsProviders")}</SectionLabel>
                <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginBottom: 10 }}>{t("lyricsProvidersDesc")}</div>
                <LyricsProviderList providers={lyricsProviders || DEFAULT_LYRICS_PROVIDERS} onChange={onLyricsProvidersChange} />
              </>
            )}

            {tab === "accessibility" && (
              <>
                <SectionLabel>{t("appearance")}</SectionLabel>
                <SettingRow label={t("highContrast")} description={t("highContrastDesc")}>
                  <Toggle value={highContrast} onChange={onToggleHighContrast} />
                </SettingRow>
                <SettingRow label={t("ambientVisualizer")} description={t("ambientVisualizerDesc")}>
                  <Toggle value={ambientVisualizer} onChange={onToggleAmbientVisualizer} />
                </SettingRow>

                <SectionLabel>{t("appFont")}</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { id: "default",    label: t("appFontDefault"),  preview: "MiSans Latin",   font: "'MiSans Latin', system-ui, sans-serif" },
                    { id: "dyslexic",   label: t("appFontDyslexic"), preview: "OpenDyslexic",   font: "'OpenDyslexic', system-ui, sans-serif" },
                  ].map(f => (
                    <div key={f.id} onClick={() => onAppFontChange(f.id)} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", borderRadius: 10, cursor: "pointer",
                      border: appFont === f.id ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                      background: appFont === f.id ? "var(--accent-dim)" : "var(--bg-elevated)",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                    onMouseEnter={e => { if (appFont !== f.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { if (appFont !== f.id) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                    >
                      <div>
                        <div style={{ fontSize: "var(--t13)", fontWeight: 600, color: "var(--text-primary)", fontFamily: f.font, marginBottom: 2 }}>{f.label}</div>
                        <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", fontFamily: f.font }}>{language === "de" ? "Franz jagt im komplett verwahrlosten Taxi quer durch Bayern" : "The quick brown fox jumps over the lazy dog"}</div>
                      </div>
                      {appFont === f.id && <Check size={16} style={{ color: "var(--accent)", flexShrink: 0, marginLeft: 12 }} />}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "shortcuts" && (
              <>
                <SectionLabel>{t("shortcuts")}</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {shortcuts.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--radius)", background: "var(--bg-elevated)" }}>
                      <span style={{ fontSize: "var(--t13)", color: "var(--text-secondary)" }}>{s.action}</span>
                      <kbd style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border)", borderRadius: 6, padding: "3px 10px", fontSize: "var(--t12)", fontFamily: "monospace", color: "var(--text-primary)", boxShadow: "0 1px 0 var(--border)", flexShrink: 0, marginLeft: 8 }}>{s.key}</kbd>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 16 }}>{t("shortcutsNote")}</div>
              </>
            )}

            {tab === "cache" && <CacheTab t={t} />}

            {tab === "downloads" && <DownloadsTab t={t} />}

            {tab === "language" && (
              <>
                <SectionLabel>{t("selectLanguage")}</SectionLabel>
                {LANGUAGES.map(lang => (
                  <div key={lang.code} onClick={() => onLanguageChange(lang.code)} style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "12px 16px", borderRadius: "var(--radius)", cursor: "pointer",
                    background: language === lang.code ? "rgba(224,64,251,0.08)" : "var(--bg-elevated)",
                    border: `0.5px solid ${language === lang.code ? "var(--accent)" : "var(--border)"}`,
                    marginBottom: 8, transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (language !== lang.code) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={e => { if (language !== lang.code) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                  >
                    <div dangerouslySetInnerHTML={{ __html: lang.flag }} style={{ width: 32, height: 20, flexShrink: 0, borderRadius: 3, overflow: "hidden", border: "0.5px solid var(--border)" }} />
                    <div style={{ fontSize: "var(--t13)", fontWeight: 500, color: language === lang.code ? "var(--accent)" : "var(--text-primary)" }}>{lang.label}</div>
                    {language === lang.code && (
                      <Check size={14} style={{ marginLeft: "auto", color: "var(--accent)" }} />
                    )}
                  </div>
                ))}
              </>
            )}

            {tab === "update" && (
              <>
                <SectionLabel>{t("currentVersion")}</SectionLabel>
                <div style={{
                  padding: "12px 16px", borderRadius: "var(--radius)",
                  background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: "var(--t14)", fontWeight: 600, color: "var(--text-primary)" }}>{APP_VERSION}</div>
                </div>

                {updateInfo ? (
                  <>
                    <SectionLabel>{t("latestVersion")}</SectionLabel>
                    <div style={{
                      padding: "16px", borderRadius: "var(--radius)",
                      background: "rgba(224,64,251,0.06)", border: "0.5px solid var(--accent)",
                      marginBottom: 16,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <ArrowCircleUp size={18} style={{ color: "var(--accent)" }} />
                        <div style={{ fontSize: "var(--t14)", fontWeight: 600, color: "var(--accent)" }}>{updateInfo.version}</div>
                      </div>
                      {updateInfo.releasedAt && (
                        <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginBottom: 12 }}>
                          {t("released")}: {new Date(updateInfo.releasedAt).toLocaleDateString()}
                        </div>
                      )}
                      {updateInfo.changelog && (
                        <>
                          <div style={{ fontSize: "var(--t11)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t("changelog")}</div>
                          <div style={{ fontSize: "var(--t12)", color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{updateInfo.changelog}</div>
                        </>
                      )}
                    </div>
                    {updateDownloaded ? (
                      <>
                        <div style={{ fontSize: "var(--t12)", color: "#4caf50", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                          <CheckCircle size={14} weight="fill" style={{ color: "#4caf50" }} />
                          {t("savedToDownloads")}
                        </div>
                        <button
                          onClick={onInstallUpdate}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            width: "100%", padding: "10px 16px", borderRadius: "var(--radius)",
                            background: "var(--accent)", border: "none", color: "#fff",
                            fontSize: "var(--t13)", fontWeight: 600, cursor: "pointer",
                            fontFamily: "var(--font)", transition: "opacity 0.15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                        >
                          <DownloadSimple size={16} />
                          {t("installNow")}
                        </button>
                      </>
                    ) : updateDownloading ? (
                      <>
                        <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <ArrowClockwise size={13} style={{ animation: "spin2 0.8s linear infinite" }} />
                          {t("downloadingUpdate")}
                        </div>
                        <div style={{ height: 4, background: "var(--bg-hover)", borderRadius: 2, overflow: "hidden", marginBottom: 10 }}>
                          <div style={{ height: "100%", width: `${updateDownloadProgress ?? 0}%`, background: "var(--accent)", transition: "width 0.3s" }} />
                        </div>
                        <button
                          onClick={onCancelDownload}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            width: "100%", padding: "9px 16px", borderRadius: "var(--radius)",
                            background: "var(--bg-elevated)", border: "0.5px solid var(--border)", color: "var(--text-secondary)",
                            fontSize: "var(--t13)", fontWeight: 500, cursor: "pointer",
                            fontFamily: "var(--font)", transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                        >
                          {t("cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={onDownloadUpdate}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          width: "100%", padding: "10px 16px", borderRadius: "var(--radius)",
                          background: "var(--accent)", border: "none", color: "#fff",
                          fontSize: "var(--t13)", fontWeight: 600, cursor: "pointer",
                          fontFamily: "var(--font)", transition: "opacity 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                      >
                        <DownloadSimple size={16} />
                        {t("downloadUpdate")}
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                    padding: "32px 16px", color: "var(--text-muted)",
                  }}>
                    <CheckCircle size={32} style={{ color: "#4caf50" }} />
                    <div style={{ fontSize: "var(--t13)", textAlign: "center" }}>{t("upToDate")}</div>
                  </div>
                )}

                <button
                  onClick={() => { setCheckingUpdate(true); onCheckUpdate().finally(() => setCheckingUpdate(false)); }}
                  disabled={checkingUpdate}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "9px 16px", marginTop: 8, borderRadius: "var(--radius)",
                    background: "var(--bg-elevated)", border: "0.5px solid var(--border)", color: "var(--text-secondary)",
                    fontSize: "var(--t13)", fontWeight: 500, cursor: checkingUpdate ? "default" : "pointer",
                    fontFamily: "var(--font)", transition: "all 0.15s",
                    opacity: checkingUpdate ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!checkingUpdate) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}}
                  onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  <ArrowClockwise size={14} style={checkingUpdate ? { animation: "spin2 0.8s linear infinite" } : undefined} />
                  {checkingUpdate ? t("checking") : t("checkForUpdates")}
                </button>
              </>
            )}

            {tab === "debug" && <DebugTab t={t} />}

          </div>
        </div>

      </div>
    </div>
  );
}


// ─── Queue Panel ────────────────────────────────────────────────────────────
// ─── Queue Row (standalone to prevent drag breaking on re-render) ────────────
function QueueRow({ track, globalIdx, isDraggable, isActive, dragOver, onPointerDown, onPlay, onRemove }) {
  return (
    <div
      data-queue-idx={globalIdx}
      onClick={onPlay}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 16px", cursor: "pointer",
        background: dragOver === globalIdx ? "rgba(224,64,251,0.12)" : isActive ? "rgba(224,64,251,0.08)" : "transparent",
        borderTop: dragOver === globalIdx ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: isDraggable ? 1 : 0.45,
        userSelect: "none",
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = dragOver === globalIdx ? "rgba(224,64,251,0.12)" : "transparent"; }}
    >
      {isDraggable && (
        <div
          onPointerDown={e => { e.stopPropagation(); onPointerDown(e, globalIdx); }}
          style={{ flexShrink: 0, cursor: "grab", padding: 2, touchAction: "none" }}
        >
          <DotsSixVertical size={16} style={{ display: "block", pointerEvents: "none", color: "var(--text-muted)" }} />
        </div>
      )}
      <div style={{ width: 36, height: 36, borderRadius: 4, overflow: "hidden", background: "var(--bg-elevated)", flexShrink: 0 }}>
        {track.thumbnail
          ? <img src={thumb(track.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--t12)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{track.title}</span>
          {track.isExplicit && <ExplicitBadge />}
        </div>
        <div style={{ fontSize: "var(--t11)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {track.artists}
        </div>
      </div>
      {isDraggable && (
        <div
          onClick={e => { e.stopPropagation(); onRemove(track.videoId); }}
          style={{ color: "var(--text-muted)", cursor: "pointer", padding: 4, borderRadius: 4, flexShrink: 0, transition: "color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.color = "#f44336"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
        >
          <X size={16} />
        </div>
      )}
    </div>
  );
}

function QueuePanel({ queue, setQueue, currentTrack, setTrack, onClose }) {
  const t = useLang();
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const isDragging = useRef(false);
  const listRef = useRef(null);
  const nowPlayingRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const target = nowPlayingRef.current;
      if (target) {
        const containerRect = el.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetScrollPos = el.scrollTop + targetRect.top - containerRect.top;
        setShowScrollTop(el.scrollTop > targetScrollPos + target.clientHeight);
      } else {
        setShowScrollTop(el.scrollTop > 180);
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const currentIdx = queue.findIndex(t => t.videoId === currentTrack?.videoId);
  const upNext = queue.slice(currentIdx + 1);
  const played = queue.slice(0, currentIdx);

  const removeTrack = useCallback((videoId) => {
    setQueue(q => q.filter(t => t.videoId !== videoId));
  }, [setQueue]);

  const dragOverRef = useRef(null);

  const handlePointerDown = useCallback((e, globalIdx) => {
    e.preventDefault();
    isDragging.current = false;
    dragOverRef.current = null;

    const startY = e.clientY;

    const onMove = (me) => {
      if (Math.abs(me.clientY - startY) > 4) isDragging.current = true;
      if (!isDragging.current || !listRef.current) return;
      const rows = listRef.current.querySelectorAll("[data-queue-idx]");
      let closest = null;
      let closestDist = Infinity;
      rows.forEach(row => {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(me.clientY - mid);
        if (dist < closestDist) { closestDist = dist; closest = row; }
      });
      if (closest) {
        const idx = parseInt(closest.dataset.queueIdx);
        dragOverRef.current = idx;
        setDragOver(idx);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const target = dragOverRef.current;
      if (isDragging.current && target !== null && target !== globalIdx) {
        setQueue(q => {
          const next = [...q];
          const [moved] = next.splice(globalIdx, 1);
          const targetIdx = target > globalIdx ? target : target;
          next.splice(targetIdx, 0, moved);
          return next;
        });
      }
      isDragging.current = false;
      dragOverRef.current = null;
      setDragIdx(null);
      setDragOver(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [setQueue]);

  const handleDragStart = useCallback((i) => {}, []);
  const handleDragOver = useCallback((i) => {}, []);
  const handleDrop = useCallback((i) => {}, []);
  const handleDragEnd = useCallback(() => {}, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "44px 16px 12px", borderBottom: "0.5px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: "var(--t14)", fontWeight: 600 }}>{t("queue")}</div>
        <button onClick={() => setQueue([])} style={{
          background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
          fontSize: "var(--t11)", color: "var(--text-muted)", borderRadius: "var(--radius)",
          fontFamily: "var(--font)", transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "#f44336"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >{t("clearQueue")}</button>
      </div>

      <div ref={listRef} className="scrollable" style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
        {/* Previously played */}
        {played.length > 0 && (
          <>
            <div style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 16px 6px" }}>{t("previouslyPlayed")}</div>
            {played.map((qt, i) => (
              <QueueRow key={qt.videoId || i} track={qt} globalIdx={i} isDraggable={false}
                isActive={false} dragOver={dragOver}
                onPointerDown={handlePointerDown}
                onPlay={() => setTrack(qt)} onRemove={removeTrack} />
            ))}
          </>
        )}

        {/* Now playing */}
        {currentTrack && (
          <>
            <div ref={nowPlayingRef} style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 16px 6px" }}>{t("nowPlaying")}</div>
            <QueueRow track={currentTrack} globalIdx={currentIdx} isDraggable={false}
              isActive={true} dragOver={dragOver}
              onPointerDown={handlePointerDown}
              onPlay={() => setTrack(currentTrack)} onRemove={removeTrack} />
          </>
        )}

        {/* Up next */}
        {upNext.length > 0 && (
          <>
            <div style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 16px 6px" }}>{t("upNext")}</div>
            {upNext.map((qt, i) => (
              <QueueRow key={qt.videoId || i} track={qt} globalIdx={currentIdx + 1 + i} isDraggable={true}
                isActive={false} dragOver={dragOver}
                onPointerDown={handlePointerDown}
                onPlay={() => setTrack(qt)} onRemove={removeTrack} />
            ))}
          </>
        )}

        {queue.length === 0 && (
          <div style={{ padding: 24, color: "var(--text-muted)", fontSize: "var(--t13)", textAlign: "center" }}>{t("emptyQueue")}</div>
        )}
      </div>

      {/* Scroll-to-top button — appears after scrolling down */}
      {showScrollTop && (
        <Tooltip text={t("scrollToTop")}><button
          onClick={() => {
            const target = nowPlayingRef.current;
            const container = listRef.current;
            if (target && container) {
              const containerRect = container.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();
              const scrollOffset = container.scrollTop + targetRect.top - containerRect.top - 8;
              container.scrollTo({ top: scrollOffset, behavior: "smooth" });
            } else {
              listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          style={{
            position: "absolute", bottom: 16, right: 16,
            width: 40, height: 40, borderRadius: "50%",
            background: "var(--accent)", border: "none", cursor: "pointer",
            color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 12px rgba(0,0,0,0.5)", zIndex: 10,
            transition: "transform 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
        ><CaretLineUp size={20} /></button></Tooltip>
      )}
    </div>
  );
}

function Player({ track, setTrack, queue, setQueue, audioRef, isPlaying, setIsPlaying, expanded, onExpandToggle, showLyrics, onToggleLyrics, queueOpen, onToggleQueue, fullscreen, onToggleFullscreen, crossfade = 0, onOpenAlbum, onOpenArtist, onExportSong, onRefetchLyrics, lyricsProviders = DEFAULT_LYRICS_PROVIDERS, currentLyricsSource = "", onSwitchLyricsProvider, failedLyricsProviders = new Set(), language = "de", showLyricsTranslation = false, onToggleLyricsTranslation, lyricsTranslationLang = "DE", onSetLyricsTranslationLang, showRomaji = false, onToggleRomaji, isCustomLyrics = false, onImportLyrics, onRemoveCustomLyrics, onPremiumDetected }) {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(localStorage.getItem("kiyoshi-volume"));
    return isNaN(saved) ? 0.4 : Math.max(0, Math.min(1, saved));
  });
  const [streamUrl, setStreamUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [songStats, setSongStats] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreClosing, setMoreClosing] = useState(false);
  const [morePos, setMorePos] = useState({ right: 0, bottom: 0 });
  const [langSubmenuOpen, setLangSubmenuOpen] = useState(false);
  const [fetchedBrowseIds, setFetchedBrowseIds] = useState({});
  const moreRef = useRef(null);
  const zoom = useZoom();

  const closeMoreMenu = useCallback(() => {
    setMoreClosing(true);
    setTimeout(() => { setMoreOpen(false); setMoreClosing(false); }, 140);
  }, []);

  // ── Sleep Timer ────────────────────────────────────────────────────────────
  const [sleepTimerEnd, setSleepTimerEnd] = useState(null); // ms timestamp
  const [sleepRemaining, setSleepRemaining] = useState(null); // seconds
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [sleepMenuClosing, setSleepMenuClosing] = useState(false);
  const sleepMenuRef = useRef(null);
  const sleepDropdownRef = useRef(null);

  const closeSleepMenu = useCallback(() => {
    setSleepMenuClosing(true);
    setTimeout(() => { setSleepMenuOpen(false); setSleepMenuClosing(false); }, 140);
  }, []);

  useEffect(() => {
    if (!sleepTimerEnd) { setSleepRemaining(null); return; }
    const tick = () => {
      const r = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
      setSleepRemaining(r);
      if (r <= 0) {
        audioRef.current?.pause();
        setIsPlaying(false);
        setSleepTimerEnd(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepTimerEnd]);

  // Close sleep menu on outside click (check both trigger div AND portal dropdown)
  useEffect(() => {
    if (!sleepMenuOpen) return;
    const handler = (e) => {
      if (
        sleepMenuRef.current && !sleepMenuRef.current.contains(e.target) &&
        sleepDropdownRef.current && !sleepDropdownRef.current.contains(e.target)
      ) closeSleepMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sleepMenuOpen]);

  const formatSleepRemaining = (s) => {
    if (s === null) return null;
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!track?.videoId) { setSongStats(null); return; }
    setSongStats(null);
    fetch(`${API}/song/stats/${track.videoId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setSongStats(d); })
      .catch(() => {});
  }, [track?.videoId]);

  // When dropdown opens and track is missing browse IDs, fetch them
  useEffect(() => {
    if (!moreOpen || !track?.videoId) return;
    if (track.albumBrowseId || track.artistBrowseId) return; // already have them
    if (fetchedBrowseIds[track.videoId]) return; // already fetched
    fetch(`${API}/song/info/${track.videoId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && !d.error) {
          setFetchedBrowseIds(prev => ({ ...prev, [track.videoId]: d }));
        }
      })
      .catch(() => {});
  }, [moreOpen, track?.videoId]);

  const moreDropdownRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e) => {
      if (
        moreRef.current && !moreRef.current.contains(e.target) &&
        moreDropdownRef.current && !moreDropdownRef.current.contains(e.target)
      ) closeMoreMenu();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moreOpen]);

  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("none");
  const t = useLang();

  // Cache: videoId -> url
  const urlCache = useRef({});

  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const queueRef = useRef(queue);
  const trackRef = useRef(track);
  const crossfadeRef = useRef(crossfade);
  const volumeRef = useRef(volume);
  const prevVolumeRef = useRef(volume > 0 ? volume : 0.4);
  // Quadratic volume curve — human hearing is logarithmic, so v² feels linear
  const volCurve = (v) => v * v;

  const crossfadeAudioRef = useRef(new Audio());
  const crossfadeActiveRef = useRef(false);
  const crossfadeNextTrackRef = useRef(null);
  const skipStreamResetRef = useRef(false);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { crossfadeRef.current = crossfade; }, [crossfade]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onVolumeChange = () => {
      const raw = audio.volume;
      const v = Math.sqrt(raw); // reverse the v² curve to get display value
      // Only update if the volume actually differs from current state to avoid
      // feedback loops (IpcAudio fires volumechange after every set volume).
      if (Math.abs(v - volumeRef.current) < 0.005) return;
      setVolume(v);
      if (v > 0) prevVolumeRef.current = v;
      localStorage.setItem("kiyoshi-volume", v);
    };
    audio.addEventListener("volumechange", onVolumeChange);
    return () => audio.removeEventListener("volumechange", onVolumeChange);
  }, []);

  const getAdjacentTrack = useCallback((dir) => {
    const q = queueRef.current;
    const t = trackRef.current;
    if (!q.length || !t) return null;
    const idx = q.findIndex(x => x.videoId === t.videoId);
    if (idx === -1) return null;
    if (dir === "next") {
      if (shuffleRef.current) return q[Math.floor(Math.random() * q.length)];
      return q[(idx + 1) % q.length];
    }
    return q[(idx - 1 + q.length) % q.length];
  }, []);

  const fetchUrl = useCallback(async (videoId) => {
    if (urlCache.current[videoId]) return urlCache.current[videoId];
    // Prefer locally cached song (served via backend, works for both Rust & HTML5)
    try {
      const cr = await fetch(`${API}/song/cached/${videoId}`, { method: "HEAD" });
      if (cr.ok) {
        const cachedUrl = `${API}/song/cached/${videoId}`;
        urlCache.current[videoId] = cachedUrl;
        return cachedUrl;
      }
    } catch {}
    // When Rust audio is active, download via yt-dlp to disk and return file path.
    // Rust reads from disk — no HTTP proxy overhead.
    const useRust = audioRef.current && audioRef.current._fallback === false;
    if (useRust) {
      try {
        const r = await fetch(`${API}/stream-prepare/${videoId}`);
        const d = await r.json();
        if (d.premium_only) { onPremiumDetected?.(videoId); return null; }
        if (d.path) {
          // Prefix with file:// so Rust knows it's a local path
          const fileUrl = `file://${d.path.replace(/\\/g, "/")}`;
          urlCache.current[videoId] = fileUrl;
          return fileUrl;
        }
      } catch (e) { console.error("[fetchUrl] stream-prepare failed:", e); }
    }
    // HTML5 fallback: fetch direct googlevideo URL (browser handles cookies)
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await fetch(`${API}/stream/${videoId}`);
        const d = await r.json();
        if (d.premium_only) { onPremiumDetected?.(videoId); return null; }
        if (d.url) { urlCache.current[videoId] = d.url; return d.url; }
      } catch {}
      if (i < 3) await new Promise(res => setTimeout(res, 800));
    }
    return null;
  }, [onPremiumDetected]);

  // Preload adjacent tracks in background
  const preloadAdjacent = useCallback(async () => {
    await new Promise(res => setTimeout(res, 2000)); // wait 2s after track change
    const next = getAdjacentTrack("next");
    const prev = getAdjacentTrack("prev");
    if (next && !urlCache.current[next.videoId]) fetchUrl(next.videoId);
    if (prev && !urlCache.current[prev.videoId]) fetchUrl(prev.videoId);
  }, [getAdjacentTrack, fetchUrl]);

  useEffect(() => {
    if (!track) return;
    // Check if track is liked
    fetch(`${API}/liked/ids`)
      .then(r => r.json())
      .then(d => setIsLiked((d.ids || []).includes(track.videoId)))
      .catch(() => {});
  }, [track?.videoId]);

  useEffect(() => {
    if (!track) return;
    setLoading(true);
    setStreamUrl(null);
    let cancelled = false;

    fetchUrl(track.videoId).then(url => {
      if (cancelled) return;
      if (url) { setStreamUrl(url); }
      else { console.error("Stream fehlgeschlagen"); }
      setLoading(false);
    });

    preloadAdjacent();
    return () => { cancelled = true; };
  }, [track]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !streamUrl) return;

    // If crossfade already transferred this track to main audio, skip restart
    if (skipStreamResetRef.current) {
      skipStreamResetRef.current = false;
      setIsPlaying(true);
      if (a.duration) setDuration(a.duration);
      return;
    }

    // Cancel any in-progress crossfade from the previous track
    const cf = crossfadeAudioRef.current;
    crossfadeActiveRef.current = false;
    crossfadeNextTrackRef.current = null;
    cf.pause();
    cf.volume = 0;

    console.log("[Player] streamUrl →", streamUrl?.substring(0, 80));
    a.src = streamUrl;
    a.volume = volCurve(volume);
    volumeRef.current = volume;
    a.play().catch(e => console.error("[Player] play() error:", e));
    setIsPlaying(true);
    setProgress(0);

    const onTime = () => setProgress(a.currentTime);
    // IpcAudio may return 0 when Rust can't determine duration from metadata;
    // fall back to the track's formatted duration string in that case.
    const onDur = () => {
      const d = a.duration > 0 ? a.duration : (parseDurationToSeconds(track?.duration) || 0);
      setDuration(d);
    };

    const onEnd = () => {
      if (crossfadeActiveRef.current && crossfadeNextTrackRef.current) {
        // Crossfade audio is already playing — transfer it to the main element
        const next = crossfadeNextTrackRef.current;
        crossfadeNextTrackRef.current = null;
        crossfadeActiveRef.current = false;
        const savedSrc = cf.src;
        const savedTime = cf.currentTime;
        cf.pause();
        cf.src = "";
        a.src = savedSrc;
        a.currentTime = savedTime;
        a.volume = volCurve(volumeRef.current);
        a.play().catch(() => {});
        skipStreamResetRef.current = true;
        setTrack(next);
      } else if (repeatRef.current === "one") {
        a.currentTime = 0; a.play();
      } else {
        const next = getAdjacentTrack("next");
        if (next) setTrack(next);
        else if (repeatRef.current === "none") setIsPlaying(false);
      }
    };

    // Crossfade: fade out current, fade in next track simultaneously
    const onTimeUpdate = () => {
      if (!crossfadeRef.current || crossfadeRef.current <= 0 || !a.duration) return;
      const remaining = a.duration - a.currentTime;

      // Fade out main audio
      if (remaining <= crossfadeRef.current && remaining > 0) {
        const vol = Math.max(0, remaining / crossfadeRef.current);
        a.volume = vol * volCurve(volumeRef.current);
      }

      // Start crossfade audio (once) when window begins
      if (remaining <= crossfadeRef.current && !crossfadeActiveRef.current) {
        crossfadeActiveRef.current = true;
        const next = getAdjacentTrack("next");
        if (!next) return;
        crossfadeNextTrackRef.current = next;
        fetchUrl(next.videoId).then(url => {
          if (!url || !crossfadeActiveRef.current) return;
          cf.src = url;
          cf.volume = 0;
          cf.play().catch(() => {});
          // Fade in crossfade audio over the crossfade window
          const cfMs = crossfadeRef.current * 1000;
          const startTs = Date.now();
          const fadeTick = () => {
            if (!crossfadeActiveRef.current) return;
            const pct = Math.min(1, (Date.now() - startTs) / cfMs);
            cf.volume = pct * volCurve(volumeRef.current);
            if (pct < 1) requestAnimationFrame(fadeTick);
          };
          requestAnimationFrame(fadeTick);
        });
      }
    };

    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  }, [streamUrl]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) { a.pause(); setIsPlaying(false); }
    else { a.play(); setIsPlaying(true); }
  };

  const isDragging = useRef(false);
  const seekBarRef = useRef(null);
  const [dragPct, setDragPct] = useState(null);

  const getPct = (clientX, rect) =>
    Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

  const seek = e => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = getPct(e.clientX, rect) * duration;
  };

  const onSeekMouseDown = e => {
    isDragging.current = true;
    setDragPct(getPct(e.clientX, e.currentTarget.getBoundingClientRect()) * 100);

    const onMove = ev => {
      if (!isDragging.current || !seekBarRef.current) return;
      const rect = seekBarRef.current.getBoundingClientRect();
      setDragPct(getPct(ev.clientX, rect) * 100);
    };

    const onUp = ev => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const a = audioRef.current;
      if (a && duration && seekBarRef.current) {
        const rect = seekBarRef.current.getBoundingClientRect();
        a.currentTime = getPct(ev.clientX, rect) * duration;
      }
      setDragPct(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleLike = async () => {
    if (!track) return;
    const newRating = isLiked ? "INDIFFERENT" : "LIKE";
    setIsLiked(!isLiked);
    try {
      await fetch(`${API}/like/${track.videoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: newRating,
          title: track.title || "",
          artists: track.artists || "",
          album: track.album || "",
          thumbnail: track.thumbnail || "",
          duration: track.duration || "",
        }),
      });
    } catch {
      setIsLiked(isLiked); // revert on error
    }
  };

  const cycleRepeat = () => {
    setRepeat(r => r === "none" ? "all" : r === "all" ? "one" : "none");
  };

  const fmt = s => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const anim = useAnimations();
  const pct = dragPct !== null ? dragPct : (duration ? (progress / duration) * 100 : 0);

  const ctrlBtn = (onClick, active, children, tooltip) => {
    const btn = (
      <button onClick={onClick} style={{
        background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        transition: anim ? `color 0.15s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)` : "color 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = active ? "var(--accent)" : "var(--text-primary)"; if (anim) e.currentTarget.style.transform = "scale(1.2)"; }}
      onMouseLeave={e => { e.currentTarget.style.color = active ? "var(--accent)" : "var(--text-secondary)"; if (anim) e.currentTarget.style.transform = "scale(1)"; }}
      >{children}</button>
    );
    return tooltip ? <Tooltip text={tooltip}>{btn}</Tooltip> : btn;
  };

  return (
    <div style={{ background: fullscreen ? "rgba(13,13,13,0.6)" : "var(--bg-surface)", backdropFilter: fullscreen ? "blur(20px)" : "none", flexShrink: 0, borderTop: fullscreen ? "none" : "0.5px solid var(--border)", position: "relative", zIndex: 50, height: 69 }}>
      <div style={{ position: "relative", height: 0 }}>
        <div
          ref={seekBarRef}
          onMouseDown={track ? onSeekMouseDown : undefined}
          onMouseEnter={track ? (e => e.currentTarget.querySelector(".seek-bar").style.height = "5px") : undefined}
          onMouseLeave={track ? (e => { if (!isDragging.current) e.currentTarget.querySelector(".seek-bar").style.height = "3px"; }) : undefined}
          style={{ position: "absolute", top: -8, left: 0, right: 0, height: 16, display: "flex", alignItems: "center", cursor: track ? "pointer" : "default", zIndex: 10 }}
        >
          <div className="seek-bar" style={{ width: "100%", height: 3, background: "var(--bg-elevated)", transition: "height 0.15s ease", pointerEvents: "none" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: dragPct !== null ? "none" : "width 0.5s linear" }} />
          </div>
        </div>
      </div>
      <div style={{ height: 68, display: "flex", alignItems: "center", padding: "0 20px", gap: 16 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, width: 340, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0, overflow: "hidden", background: "var(--bg-elevated)",
            animation: anim && track ? "coverPop 0.5s cubic-bezier(0.34,1.56,0.64,1)" : "none",
          }}>
            {track?.thumbnail
              ? <img src={thumb(track.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ width: "100%", height: "100%", background: track ? "linear-gradient(135deg,#2a1535,#1a0a25)" : "transparent" }} />}
          </div>
          <div style={{ overflow: "hidden" }}>
            <div style={{ fontSize: "var(--t13)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{loading ? t("loading") : track?.title}</span>
              {track?.isExplicit && <ExplicitBadge />}
            </div>
            <div style={{ fontSize: "var(--t11)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {track?.artists}
            </div>
            <div style={{ fontSize: "var(--t10)", color: "var(--text-muted)", marginTop: 2 }}>
              {track ? `${fmt(progress)} / ${fmt(duration)}` : ""}
            </div>
          </div>
          {/* Like button */}
          <Tooltip text={isLiked ? t("unlike") : t("like")}><button onClick={track ? toggleLike : undefined} style={{ visibility: track ? "visible" : "hidden",
            background: "none", border: "none", cursor: "pointer", padding: 6, flexShrink: 0,
            color: isLiked ? "var(--accent)" : "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: anim ? "color 0.2s, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)" : "color 0.2s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = isLiked ? "var(--accent)" : "var(--text-secondary)"; if (anim) e.currentTarget.style.transform = "scale(1.2)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = isLiked ? "var(--accent)" : "var(--text-muted)"; if (anim) e.currentTarget.style.transform = "scale(1)"; }}
          >
            {isLiked ? <Heart size={16} weight="fill" /> : <Heart size={16} />}
          </button></Tooltip>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          {ctrlBtn(() => setShuffle(s => !s), shuffle,
            <Shuffle size={16} />,
            t("shuffle")
          )}
          <Tooltip text={t("scPrev")}><button
            disabled={!track}
            onClick={() => {
              const audio = audioRef.current;
              if (audio && audio.currentTime >= 4) {
                audio.currentTime = 0;
              } else {
                const t = getAdjacentTrack("prev"); if (t) setTrack(t);
              }
            }}
            style={{
              width: 42, height: 34, borderRadius: 10,
              background: "transparent",
              border: "none", cursor: track ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: track ? "var(--accent)" : "var(--text-muted)",
              opacity: track ? 1 : 0.35,
              transition: anim ? `background 0.15s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)` : "background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (!track) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              if (anim) e.currentTarget.style.transform = "scale(1.08)";
            }}
            onMouseLeave={e => { if (!track) return;
              e.currentTarget.style.background = "transparent";
              if (anim) e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={e => { if (track && anim) e.currentTarget.style.transform = "scale(0.93)"; }}
            onMouseUp={e => { if (track && anim) e.currentTarget.style.transform = "scale(1.05)"; }}
          >
            <SkipBack size={22} />
          </button></Tooltip>
          <button disabled={!track} onClick={track ? togglePlay : undefined} style={{
            width: 42, height: 42, borderRadius: "50%",
            background: track ? "var(--accent)" : "var(--bg-elevated)",
            border: "none", cursor: track ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: track ? 1 : 0.35,
            transition: anim ? spring("transform") : "none",
            flexShrink: 0,
          }}
          onMouseEnter={e => { if (track && anim) e.currentTarget.style.transform = "scale(1.12)"; }}
          onMouseLeave={e => { if (anim) e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { if (track && anim) e.currentTarget.style.transform = "scale(0.92)"; }}
          onMouseUp={e => { if (track && anim) e.currentTarget.style.transform = "scale(1.08)"; }}
          >
            {isPlaying ? <Pause size={16} style={{ color: track ? "white" : "var(--text-muted)" }} /> : <Play size={16} style={{ color: track ? "white" : "var(--text-muted)" }} />}
          </button>
          <Tooltip text={t("scNext")}><button
            disabled={!track}
            onClick={() => { const t = getAdjacentTrack("next"); if (t) setTrack(t); }}
            style={{
              width: 42, height: 34, borderRadius: 10,
              background: "transparent",
              border: "none", cursor: track ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: track ? "var(--accent)" : "var(--text-muted)",
              opacity: track ? 1 : 0.35,
              transition: anim ? `background 0.15s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)` : "background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (!track) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              if (anim) e.currentTarget.style.transform = "scale(1.08)";
            }}
            onMouseLeave={e => { if (!track) return;
              e.currentTarget.style.background = "transparent";
              if (anim) e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={e => { if (track && anim) e.currentTarget.style.transform = "scale(0.93)"; }}
            onMouseUp={e => { if (track && anim) e.currentTarget.style.transform = "scale(1.05)"; }}
          >
            <SkipForward size={22} />
          </button></Tooltip>
          {ctrlBtn(cycleRepeat, repeat !== "none",
            repeat === "one"
              ? <RepeatOnce size={16} />
              : <Repeat size={16} />,
            repeat === "one" ? t("repeatOne") : repeat === "all" ? t("repeatAll") : t("repeat")
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, width: 340, justifyContent: "flex-end" }}>
          {/* Volume icon + slider */}
          <div data-volume-area style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Tooltip text={volume === 0 ? t("unmute") : t("mute")}><button onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            const newVol = volume > 0 ? 0 : prevVolumeRef.current;
            a.volume = volCurve(newVol);
          }} style={{
            background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: "50%", flexShrink: 0,
            color: volume === 0 ? "var(--text-muted)" : "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary)"}
          onMouseLeave={e => e.currentTarget.style.color = volume === 0 ? "var(--text-muted)" : "var(--text-secondary)"}
          >
            {volume === 0
              ? <SpeakerX size={15} />
              : volume < 0.5
              ? <SpeakerLow size={15} />
              : <SpeakerHigh size={15} />
            }
          </button></Tooltip>
          {/* Volume slider */}
          <div
            onMouseDown={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const getV = (clientX) => Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
              const v = getV(e.clientX);
              setVolume(v);
              if (audioRef.current) audioRef.current.volume = volCurve(v);
              const onMove = ev => {
                const v2 = getV(ev.clientX);
                setVolume(v2);
                if (audioRef.current) audioRef.current.volume = volCurve(v2);
              };
              const onUp = (ev) => {
                const finalV = getV(ev.clientX);
                localStorage.setItem("kiyoshi-volume", finalV);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
            onMouseEnter={e => e.currentTarget.querySelector(".vol-bar").style.height = "5px"}
            onMouseLeave={e => e.currentTarget.querySelector(".vol-bar").style.height = "3px"}
            style={{ width: 70, height: 16, display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <div className="vol-bar" style={{ width: "100%", height: 3, background: "var(--bg-elevated)", borderRadius: 2, overflow: "hidden", transition: "height 0.15s ease", pointerEvents: "none" }}>
              <div style={{ width: `${volume * 100}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>
          </div>
          {/* Sleep Timer */}
          <div ref={sleepMenuRef} style={{ position: "relative", flexShrink: 0 }}>
            <Tooltip text={sleepRemaining !== null ? `${translate(language, "sleepTimer")}: ${formatSleepRemaining(sleepRemaining)}` : translate(language, "sleepTimer")}>
            <button onClick={() => { sleepMenuOpen ? closeSleepMenu() : setSleepMenuOpen(true); }} style={{
              background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: "50%",
              color: sleepRemaining !== null ? "var(--accent)" : (sleepMenuOpen ? "var(--text-primary)" : "var(--text-secondary)"),
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 0.15s", position: "relative",
            }}
            onMouseEnter={e => e.currentTarget.style.color = sleepRemaining !== null ? "var(--accent)" : "var(--text-primary)"}
            onMouseLeave={e => e.currentTarget.style.color = sleepRemaining !== null ? "var(--accent)" : (sleepMenuOpen ? "var(--text-primary)" : "var(--text-secondary)")}
            >
              <Moon size={15} weight={sleepRemaining !== null ? "fill" : "regular"} />
              {sleepRemaining !== null && (
                <span style={{
                  position: "absolute", top: 0, right: -2,
                  fontSize: 8, fontWeight: 700, lineHeight: 1,
                  color: "var(--accent)", pointerEvents: "none",
                }}>●</span>
              )}
            </button>
            </Tooltip>
            {(sleepMenuOpen || sleepMenuClosing) && createPortal((() => {
              const btn = sleepMenuRef.current?.getBoundingClientRect();
              const pos = btn ? { right: window.innerWidth - btn.right, bottom: window.innerHeight - btn.top + 8 } : { right: 80, bottom: 80 };
              const PRESETS = [5, 10, 15, 20, 30, 45, 60];
              return (
                <div ref={sleepDropdownRef} style={{
                  position: "fixed", right: pos.right, bottom: pos.bottom,
                  background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
                  borderRadius: 10, padding: 4, minWidth: 170, zIndex: 99999,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zoom,
                  animation: sleepMenuClosing ? "ctxMenuOut 0.14s ease-in forwards" : "ctxMenuIn 0.14s ease-out",
                  transformOrigin: "bottom right",
                }}>
                  <div style={{ padding: "6px 12px 6px", fontSize: "var(--t11)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    {translate(language, "sleepTimer")}
                  </div>
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "0 0 4px" }} />
                  {PRESETS.map(min => (
                    <div key={min}
                      onClick={() => { setSleepTimerEnd(Date.now() + min * 60 * 1000); closeSleepMenu(); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer",
                        fontSize: "var(--t13)", color: "var(--text-primary)",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span>{min} {translate(language, "minutes")}</span>
                      {sleepTimerEnd && Math.abs((sleepTimerEnd - Date.now()) / 60000 - min) < 1 && (
                        <Check size={12} style={{ color: "var(--accent)" }} />
                      )}
                    </div>
                  ))}
                  {sleepRemaining !== null && (
                    <>
                      <div style={{ height: "0.5px", background: "var(--border)", margin: "4px 0" }} />
                      <div
                        onClick={() => { setSleepTimerEnd(null); closeSleepMenu(); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer",
                          fontSize: "var(--t13)", color: "#f44336",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <X size={13} />
                        {translate(language, "cancelSleepTimer")}
                        <span style={{ marginLeft: "auto", fontSize: "var(--t12)", color: "var(--accent)", fontWeight: 600 }}>
                          {formatSleepRemaining(sleepRemaining)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })(), document.body)}
          </div>

          {/* More Info dropdown */}
          {track && (
            <div ref={moreRef} style={{ position: "relative", flexShrink: 0 }}>
              <button onClick={() => {
                if (!moreOpen && moreRef.current) {
                  const r = moreRef.current.getBoundingClientRect();
                  // getBoundingClientRect() gibt bereits visuelle (viewport) Koordinaten zurück.
                  // Das Portal liegt außerhalb des gezoomten Containers → Position unverändert,
                  // aber Größe muss mit zoom skaliert werden.
                  setMorePos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 });
                }
                moreOpen ? closeMoreMenu() : setMoreOpen(true);
              }} style={{
                background: "none", border: "none", cursor: "pointer", padding: 6,
                color: moreOpen ? "var(--accent)" : "var(--text-secondary)",
                display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.color = moreOpen ? "var(--accent)" : "var(--text-primary)"}
              onMouseLeave={e => e.currentTarget.style.color = moreOpen ? "var(--accent)" : "var(--text-secondary)"}
              >
                <DotsThreeVertical size={18} />
              </button>

              {(moreOpen || moreClosing) && createPortal(
                <div ref={moreDropdownRef} style={{
                  position: "fixed", right: morePos.right, bottom: morePos.bottom,
                  background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
                  borderRadius: 10, padding: "4px", minWidth: 220, zIndex: 99999,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  display: "flex", flexDirection: "column", gap: 2,
                  animation: moreClosing ? "ctxMenuOut 0.14s ease-in forwards" : "ctxMenuIn 0.14s ease-out",
                  transformOrigin: "bottom right",
                  zoom,
                }}>
                  {/* Stats */}
                  {songStats && (
                    <>
                      <div style={{ padding: "6px 12px 8px", display: "flex", gap: 14 }}>
                        {songStats.views && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--t12)", color: "var(--text-muted)" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            {songStats.views}
                          </div>
                        )}
                        {songStats.likes && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--t12)", color: "var(--text-muted)" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
                            {songStats.likes}
                          </div>
                        )}
                        {songStats.dislikes && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--t12)", color: "var(--text-muted)" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ transform: "rotate(180deg)" }}><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
                            {songStats.dislikes}
                          </div>
                        )}
                      </div>
                      <div style={{ height: "0.5px", background: "var(--border)", margin: "0 0 4px" }} />
                    </>
                  )}

                  {/* Navigation */}
                  {(() => {
                    const fetched = fetchedBrowseIds[track?.videoId] || {};
                    const albumId = track.albumBrowseId || fetched.albumBrowseId;
                    const artistId = track.artistBrowseId || fetched.artistBrowseId;
                    return (<>
                      {albumId && onOpenAlbum && (
                        <div
                          onClick={() => { closeMoreMenu(); if (expanded) onExpandToggle(); onOpenAlbum({ browseId: albumId, title: track.album }); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <VinylRecord size={14} />
                          {translate(language, "goToAlbum")}
                        </div>
                      )}
                      {artistId && onOpenArtist && (
                        <div
                          onClick={() => { closeMoreMenu(); if (expanded) onExpandToggle(); onOpenArtist({ browseId: artistId, artist: track.artists }); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <Microphone size={14} />
                          {translate(language, "goToArtist")}
                        </div>
                      )}
                    </>);
                  })()}

                  {/* Separator before lyrics/export */}
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />

                  {/* Refetch Lyrics */}
                  <div
                    onClick={() => { closeMoreMenu(); onRefetchLyrics?.(); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <ArrowClockwise size={14} />
                    {translate(language, "refetchLyrics")}
                  </div>

                  {/* Import Lyrics */}
                  <div
                    onClick={() => { closeMoreMenu(); onImportLyrics?.(); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <UploadSimple size={14} />
                    {translate(language, "importLyrics")}
                  </div>

                  {/* Remove Custom Lyrics — only visible when custom lyrics are active */}
                  {isCustomLyrics && (
                    <div
                      onClick={() => { closeMoreMenu(); onRemoveCustomLyrics?.(); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "#f44336" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <Trash size={14} />
                      {translate(language, "removeCustomLyrics")}
                    </div>
                  )}

                  {/* Translate Lyrics toggle */}
                  <div
                    onClick={() => onToggleLyricsTranslation?.()}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: showLyricsTranslation ? "var(--text-primary)" : "var(--text-secondary)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <Translate size={14} />
                    <span style={{ flex: 1 }}>{translate(language, "translateLyrics")}</span>
                    {showLyricsTranslation && <Check size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                  </div>

                  {/* Translation language submenu — only visible when translation is on */}
                  {showLyricsTranslation && (() => {
                    const LANGS = [
                      { code: "DE", name: "Deutsch" }, { code: "EN", name: "English" },
                      { code: "FR", name: "Français" }, { code: "ES", name: "Español" },
                      { code: "IT", name: "Italiano" }, { code: "PT", name: "Português" },
                      { code: "NL", name: "Nederlands" }, { code: "PL", name: "Polski" },
                      { code: "RU", name: "Русский" }, { code: "JA", name: "日本語" },
                      { code: "KO", name: "한국어" }, { code: "ZH", name: "中文" },
                    ];
                    const activeLang = LANGS.find(l => l.code === lyricsTranslationLang);
                    return (
                      <div style={{ position: "relative" }}
                        onMouseEnter={() => setLangSubmenuOpen(true)}
                        onMouseLeave={() => setLangSubmenuOpen(false)}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Translate size={14} />
                            {activeLang?.name || lyricsTranslationLang}
                          </span>
                          <CaretDown size={10} style={{ transform: "rotate(-90deg)", color: "var(--text-muted)" }} />
                        </div>
                        {langSubmenuOpen && (
                          <div style={{
                            position: "absolute", right: "calc(100% - 4px)", bottom: 0,
                            background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
                            borderRadius: "var(--radius-lg)", padding: "4px 4px 4px 8px", minWidth: 150,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 100000,
                          }}>
                            {LANGS.map(({ code, name }) => (
                              <div key={code}
                                onClick={e => { e.stopPropagation(); onSetLyricsTranslationLang?.(code); setLangSubmenuOpen(false); }}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t12)", color: lyricsTranslationLang === code ? "var(--text-primary)" : "var(--text-secondary)" }}
                                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                <span>{name}</span>
                                {lyricsTranslationLang === code && <Check size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Separator before provider switcher */}
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />

                  {/* Lyrics Provider Switcher */}
                  <div style={{ fontSize: "var(--t10)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "6px 12px 2px" }}>
                    {translate(language, "lyricsSource") || "Lyrics Quelle"}
                  </div>
                  {lyricsProviders.filter(p => p.enabled).map(p => {
                    const sync = PROVIDER_SYNC[p.id];
                    const isActive = currentLyricsSource === p.label;
                    const isFailed = failedLyricsProviders.has(p.id);
                    return (
                      <div key={p.id}
                        onClick={() => { if (isFailed) return; closeMoreMenu(); onSwitchLyricsProvider?.(p.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: "var(--radius)", cursor: isFailed ? "not-allowed" : "pointer", fontSize: "var(--t12)", color: isFailed ? "var(--text-muted)" : isActive ? "var(--text-primary)" : "var(--text-secondary)", background: "transparent", opacity: isFailed ? 0.45 : 1 }}
                        onMouseEnter={e => { if (!isFailed) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ flex: 1 }}>{p.label}</span>
                        {sync && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t10)", color: sync.color, background: sync.bg, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                          {sync.icon && <span style={{ display: "inline-block", width: 16, height: 16, flexShrink: 0, alignSelf: "center", backgroundColor: "currentColor", maskImage: `url(${sync.icon})`, WebkitMaskImage: `url(${sync.icon})`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />}
                          {sync.label}
                        </span>}
                        {isActive && <Check size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                      </div>
                    );
                  })}

                  {/* Separator before export */}
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />

                  {/* Export */}
                  {[
                    { label: translate(language, "saveAsMp3"), fmt: "mp3", icon: <MusicNote size={14} /> },
                    { label: translate(language, "saveAsOpus"), fmt: "opus", icon: <MusicNote size={14} /> },
                  ].map(item => (
                    <div key={item.fmt}
                      onClick={async () => { closeMoreMenu(); await onExportSong?.(track, item.fmt); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      {item.icon}
                      {item.label}
                    </div>
                  ))}
                </div>
              , document.body)}
            </div>
          )}

          {/* Queue toggle */}
          <Tooltip text={t("queueTooltip")}><button onClick={onToggleQueue} style={{
            background: "none", border: "none", cursor: "pointer", padding: 6,
            color: queueOpen ? "var(--accent)" : "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = queueOpen ? "var(--accent)" : "var(--text-primary)"}
          onMouseLeave={e => e.currentTarget.style.color = queueOpen ? "var(--accent)" : "var(--text-secondary)"}
          >
            <Queue size={16} />
          </button></Tooltip>
          {/* Lyrics toggle */}
          <Tooltip text={t("lyricsTooltip")}><button onClick={onToggleLyrics} style={{
            background: "none", border: "none", cursor: "pointer", padding: 6,
            color: (expanded && showLyrics) ? "var(--accent)" : "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = (expanded && showLyrics) ? "var(--accent)" : "var(--text-primary)"}
          onMouseLeave={e => e.currentTarget.style.color = (expanded && showLyrics) ? "var(--accent)" : "var(--text-secondary)"}
          >
            <ChatText size={16} />
          </button></Tooltip>
          {/* Expand toggle */}
          <button onClick={onExpandToggle} style={{
            background: "none", border: "none", cursor: "pointer", padding: 6,
            color: expanded ? "var(--accent)" : "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = expanded ? "var(--accent)" : "var(--text-primary)"}
          onMouseLeave={e => e.currentTarget.style.color = expanded ? "var(--accent)" : "var(--text-secondary)"}
          >
            <CaretUp size={16} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)" }} />
          </button>
          {/* Fullscreen toggle */}
          <Tooltip text={t("fullscreenTooltip")}><button onClick={onToggleFullscreen} style={{
            background: "none", border: "none", cursor: "pointer", padding: 6,
            color: fullscreen ? "var(--accent)" : "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = fullscreen ? "var(--accent)" : "var(--text-primary)"}
          onMouseLeave={e => e.currentTarget.style.color = fullscreen ? "var(--accent)" : "var(--text-secondary)"}
          >
            {fullscreen ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
          </button></Tooltip>

        </div>

      </div>
    </div>
  );
}

function hiResThumb(url) {
  if (!url) return url;
  if (url.includes("lh3.googleusercontent.com"))
    return url.replace(/=w\d+-h\d+[^"'\s]*/,  "=w600-h600-l90-rj");
  return url;
}

function CoverView({ track, isPlaying, onClose, ambientVisualizer = true }) {
  const hq = hiResThumb(track.thumbnail);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d0d" }}>
      {/* Blurred background */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: hq ? `url(${thumb(hq)})` : "none",
        backgroundSize: "cover", backgroundPosition: "center",
        filter: "blur(60px) brightness(0.35)",
        transform: "scale(1.15)",
        animation: ambientVisualizer ? "ambientBreatheCover 14s ease-in-out infinite" : "none",
      }} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1 }} />

      {/* Ambient colour blobs — negative inset keeps edges outside the visible area */}
      {ambientVisualizer && (<>
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 2, pointerEvents: "none",
          background: "radial-gradient(ellipse 38% 32% at 44% 42%, var(--accent) 0%, transparent 70%)",
          mixBlendMode: "screen",
          animation: "blobDrift1 18s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 2, pointerEvents: "none",
          background: "radial-gradient(ellipse 32% 38% at 62% 60%, #7b2ff7 0%, transparent 68%)",
          mixBlendMode: "screen",
          animation: "blobDrift2 23s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 2, pointerEvents: "none",
          background: "radial-gradient(ellipse 44% 36% at 52% 48%, #1565c0 0%, transparent 65%)",
          mixBlendMode: "screen",
          animation: "blobDrift3 29s ease-in-out infinite",
        }} />
      </>)}

      {/* Content */}
      <div style={{ position: "relative", zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        {/* Album cover */}
        <div style={{
          width: 260, height: 260, borderRadius: 16, overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          transform: isPlaying ? "scale(1.03)" : "scale(0.97)",
          transition: "transform 0.6s cubic-bezier(0.4,0,0.2,1)",
        }}>
          {hq
            ? <img src={thumb(hq)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />
          }
        </div>

        {/* Track info */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "var(--t22)", fontWeight: 700, color: "#fff", marginBottom: 6, maxWidth: 400, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{track.title}</span>
            {track.isExplicit && <ExplicitBadge />}
          </div>
          <div style={{ fontSize: "var(--t14)", color: "rgba(255,255,255,0.6)" }}>{track.artists}</div>
        </div>
      </div>
    </div>
  );
}



function parseLrc(lrc) {
  if (!lrc) return [];
  const lines = [];
  for (const line of lrc.split("\n")) {
    const m = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
    if (m) {
      const time = parseInt(m[1]) * 60 + parseFloat(m[2]);
      lines.push({ time, text: m[3].trim() });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function parseRichSync(richsync) {
  // Musixmatch RichSync: [{ ts, te, l: [{c, o}], x }, ...]
  // ts/te = line start/end in seconds, l[i].c = word/char, l[i].o = offset from ts
  if (!Array.isArray(richsync)) return [];
  return richsync
    .filter(line => line && typeof line.ts === "number")
    .map(line => {
      const words = (line.l || []).map((w, j) => {
        const wordStart = line.ts + (w.o || 0);
        const wordEnd = line.l[j + 1] ? line.ts + line.l[j + 1].o : line.te;
        return { text: w.c, time: wordStart, end: wordEnd, isSpace: (w.c || "").trim() === "" };
      });
      return { time: line.ts, endTime: line.te, words, wordSync: true, text: line.x || "" };
    });
}

function parseTtml(ttml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(ttml, "text/xml");

  // Detect timing mode: "Line" = one timestamp per line, "Word" = per-word timestamps
  const ttEl = doc.querySelector("tt");
  const timingMode = ttEl?.getAttribute("itunes:timing") || ttEl?.getAttribute("composer:timing") || "Word";
  const isLineSync = timingMode === "Line";

  // Parse agents from <head><metadata><ttm:agent>
  const TTM_NS = "http://www.w3.org/ns/ttml#metadata";
  const agents = {};
  let leadAgentId = null;
  const agentEls = doc.getElementsByTagNameNS(TTM_NS, "agent");
  for (const a of agentEls) {
    const id = a.getAttribute("xml:id");
    const type = a.getAttribute("type");
    const nameEls = a.getElementsByTagNameNS(TTM_NS, "name");
    const name = nameEls[0]?.textContent?.trim();
    if (id) {
      agents[id] = { id, type, name };
      if (!leadAgentId && type === "person") leadAgentId = id;
    }
  }

  const lines = [];
  for (const p of doc.querySelectorAll("p")) {
    const begin = p.getAttribute("begin");
    const end = p.getAttribute("end");
    if (!begin) continue;
    const time = ttmlTimeToSeconds(begin);
    const endTime = end ? ttmlTimeToSeconds(end) : null;

    // Resolve agent and role
    const agentId = p.getAttribute("ttm:agent");
    const agent = agentId ? (agents[agentId] || null) : null;
    let agentRole = null;
    if (agent) {
      if (agent.type === "group") agentRole = "group";
      else if (agentId === leadAgentId) agentRole = "lead";
      else agentRole = "featured";
    }

    if (isLineSync) {
      // Line-sync: treat entire <p> text as one unit, wipe smoothly over [time, endTime]
      const text = p.textContent?.trim();
      if (text) lines.push({ time, endTime, text, wordSync: false, lineSync: true, agent, agentRole });
      continue;
    }

    // Word-sync: extract per-span timestamps
    const words = [];
    const processNode = (node, inheritBegin, inheritEnd) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text) words.push({
          text,
          time: ttmlTimeToSeconds(inheritBegin || begin),
          end: ttmlTimeToSeconds(inheritEnd || end || begin),
          isSpace: text.trim() === "",
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const b = node.getAttribute("begin") || inheritBegin || begin;
        const e = node.getAttribute("end") || inheritEnd || end || begin;
        for (const child of node.childNodes) processNode(child, b, e);
      }
    };

    for (const child of p.childNodes) processNode(child, begin, end);
    if (words.length) lines.push({ time, endTime, words, wordSync: true, agent, agentRole });
  }
  return lines;
}

function ttmlTimeToSeconds(t) {
  if (!t) return 0;
  // Format: HH:MM:SS.mmm or MM:SS.mmm
  const parts = t.split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(t);
}

function parseDurationToSeconds(str) {
  if (!str) return null;
  const parts = str.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatTotalDuration(tracks) {
  const totalSecs = tracks.reduce((sum, t) => sum + (parseDurationToSeconds(t.duration) || 0), 0);
  if (totalSecs <= 0) return null;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

const DEFAULT_LYRICS_PROVIDERS = [
  { id: "better",     label: "Better Lyrics", enabled: true },
  { id: "musixmatch", label: "Musixmatch",    enabled: true },
  { id: "lrclib",     label: "LRCLIB",        enabled: true },
  { id: "kugou",      label: "Kugou",         enabled: true },
  { id: "simp",       label: "SimpMusic",     enabled: true },
];

// Sync-type tags shown next to each provider in settings
const PROVIDER_SYNC = {
  better:     { label: "Syllable", icon: "/sync-syllable.svg", color: "#ce93d8", bg: "rgba(206,147,216,0.12)" },
  musixmatch: { label: "Word",     icon: "/sync-word.svg",     color: "#f48fb1", bg: "rgba(244,143,177,0.12)" },
  lrclib:     { label: "Line",     icon: "/sync-line.svg",     color: "#81c784", bg: "rgba(129,199,132,0.12)" },
  kugou:      { label: "Line",     icon: "/sync-line.svg",     color: "#81c784", bg: "rgba(129,199,132,0.12)" },
  simp:       { label: "Line",     icon: "/sync-line.svg",     color: "#81c784", bg: "rgba(129,199,132,0.12)" },
};

async function fetchLyrics(title, artist, album, duration, providers = DEFAULT_LYRICS_PROVIDERS, videoId = "") {
  const tryBetter = async () => {
    const params = new URLSearchParams({ title, artist, source: "better" });
    if (album) params.set("album", album);
    if (duration) params.set("duration", Math.round(duration));
    const r = await fetch(`${API}/lyrics?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d?.ttml) { const lrc = parseTtml(d.ttml); if (lrc.length) return { source: "Better Lyrics", lrc }; }
    }
    return null;
  };
  const tryLrclib = async () => {
    const params = new URLSearchParams({ title, artist, source: "lrclib" });
    const r = await fetch(`${API}/lyrics?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d.synced) return { source: "LRCLIB", lrc: parseLrc(d.synced) };
      if (d.plain) return { source: "LRCLIB", lrc: d.plain.split("\n").map(t => ({ time: -1, text: t })) };
    }
    return null;
  };
  const tryKugou = async () => {
    const params = new URLSearchParams({ title, artist, source: "kugou" });
    if (duration) params.set("duration", Math.round(duration));
    const r = await fetch(`${API}/lyrics?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d.synced) return { source: "Kugou", lrc: parseLrc(d.synced) };
    }
    return null;
  };
  const trySimp = async () => {
    const params = new URLSearchParams({ title, artist, source: "simp" });
    if (videoId) params.set("videoId", videoId);
    const r = await fetch(`${API}/lyrics?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d.synced) return { source: "SimpMusic", lrc: parseLrc(d.synced) };
      if (d.plain) return { source: "SimpMusic", lrc: d.plain.split("\n").map(t => ({ time: -1, text: t })) };
    }
    return null;
  };
  const tryMusixmatch = async () => {
    const params = new URLSearchParams({ title, artist, source: "musixmatch" });
    if (duration) params.set("duration", Math.round(duration));
    const r = await fetch(`${API}/lyrics?${params}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.richsync) { const lrc = parseRichSync(d.richsync); if (lrc.length) return { source: "Musixmatch", lrc }; }
    if (d.synced)   return { source: "Musixmatch", lrc: parseLrc(d.synced) };
    if (d.plain)    return { source: "Musixmatch", lrc: d.plain.split("\n").map(t => ({ time: -1, text: t })) };
    return null;
  };

  const tryFns = { better: tryBetter, lrclib: tryLrclib, kugou: tryKugou, simp: trySimp, musixmatch: tryMusixmatch };
  const enabledProviders = providers.filter(p => p.enabled && tryFns[p.id]);

  // Fetch all providers in parallel — so we know which ones have no lyrics
  const settled = await Promise.all(
    enabledProviders.map(p => tryFns[p.id]().catch(() => null).then(r => ({ id: p.id, result: r })))
  );

  // Pick best result in priority order, collect failures
  const failedIds = [];
  let bestResult = null;
  for (const p of enabledProviders) {
    const { result } = settled.find(s => s.id === p.id);
    if (result) { if (!bestResult) bestResult = result; }
    else failedIds.push(p.id);
  }

  return bestResult ? { ...bestResult, failedIds } : { failedIds };
}

// LEGACY - replaced above
async function _fetchLyrics_unused(title, artist, album, duration) {
  // 1. Kimuco Lyrics (Supabase)
  try {
    const q = encodeURIComponent(title.toLowerCase());
    const url = `${SUPABASE_URL}/rest/v1/Kimuco%20Lyrics?select=synced_lyrics&title=ilike.${q}&limit=1`;
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const d = await r.json();
    if (d?.[0]?.synced_lyrics) return { source: "Kimuco", lrc: parseLrc(d[0].synced_lyrics) };
  } catch {}

  // 2. Better Lyrics
  try {
    const params = new URLSearchParams({ s: title, a: artist });
    if (album) params.set("al", album);
    if (duration) params.set("d", Math.round(duration));
    const r = await fetch(`https://lyrics-api.boidu.dev/getLyrics?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d?.ttml) { const lrc = parseTtml(d.ttml); if (lrc.length) return { source: "Better Lyrics", lrc }; }
    }
  } catch {}

  // 3. LRCLIB
  try {
    const r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`);
    if (r.ok) {
      const d = await r.json();
      if (d.syncedLyrics) return { source: "LRCLIB", lrc: parseLrc(d.syncedLyrics) };
      if (d.plainLyrics) return { source: "LRCLIB", lrc: d.plainLyrics.split("\n").map(t => ({ time: -1, text: t })) };
    }
  } catch {}

  return null;
}

function LyricsOverlay({ track, audioRef, onClose, fontSize = 32, providers = DEFAULT_LYRICS_PROVIDERS, refetchKey = 0, onAddToast, language = "de", forcedProvider = null, onSourceChange, onProviderFailed, showTranslation = false, translationLang = "DE", translationFontSize = 20, showRomaji = false, romajiFontSize = 18, onCustomLyricsStatusChange, importLyricsRef, removeCustomLyricsRef, showAgentTags = true, ambientVisualizer = true }) {
  const [lyrics, setLyrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [tick, setTick] = useState(0);
  const [translations, setTranslations] = useState(null); // array of strings, one per lyric line
  const [translating, setTranslating] = useState(false);
  const [romajiLines, setRomajiLines] = useState(null); // array of romaji strings
  const [isCustomLyrics, setIsCustomLyrics] = useState(false);
  const [customLyricsKey, setCustomLyricsKey] = useState(0);
  const t = useLang();
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const lyricsDataRef = useRef(null); // rAF loop reads lyrics without closure
  const lastIdxRef = useRef(-1);      // tracks active line to detect changes
  const wordElsRef = useRef([]);      // DOM refs to active line's word spans
  const activeWordIdxRef = useRef(-1); // tracks active word within line
  // High-resolution playback time: interpolate between timeupdate events
  const audioSnapRef = useRef({ ct: 0, pt: 0, playing: false });

  // Keep lyricsDataRef in sync with state
  useEffect(() => { lyricsDataRef.current = lyrics; }, [lyrics]);

  // Fetch translations when showTranslation is enabled, lyrics change, or target language changes
  useEffect(() => {
    if (!showTranslation || !lyrics || lyrics.length === 0) {
      if (!showTranslation) setTranslations(null);
      return;
    }
    const lines = lyrics.map(line =>
      line.wordSync ? line.words.map(w => w.text).join("") : (line.text || "")
    );
    setTranslating(true);
    setTranslations(null);
    fetch("http://localhost:9847/translate-lyrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, target_lang: translationLang }),
    })
      .then(r => r.json())
      .then(d => { setTranslations(d.translations || null); })
      .catch(() => setTranslations(null))
      .finally(() => setTranslating(false));
  }, [showTranslation, lyrics, translationLang]);

  // Fetch Romaji when toggle is enabled or lyrics change
  useEffect(() => {
    if (!showRomaji || !lyrics || lyrics.length === 0) {
      if (!showRomaji) setRomajiLines(null);
      return;
    }
    const lines = lyrics.map(line =>
      line.wordSync ? line.words.map(w => w.text).join("") : (line.text || "")
    );
    fetch("http://localhost:9847/romanize-lyrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    })
      .then(r => r.json())
      .then(d => { setRomajiLines(d.romanizations || null); })
      .catch(() => setRomajiLines(null));
  }, [showRomaji, lyrics]);

  // Sync audio snap so the rAF loop can interpolate currentTime at 60 fps
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const snap = () => {
      audioSnapRef.current = { ct: audio.currentTime, pt: performance.now(), playing: !audio.paused };
    };
    audio.addEventListener("timeupdate", snap);
    audio.addEventListener("play",       snap);
    audio.addEventListener("pause",      snap);
    audio.addEventListener("seeked",     snap);
    snap(); // initial
    return () => {
      audio.removeEventListener("timeupdate", snap);
      audio.removeEventListener("play",       snap);
      audio.removeEventListener("pause",      snap);
      audio.removeEventListener("seeked",     snap);
    };
  }, [audioRef]);

  // rAF loop: line changes trigger React re-render; word highlighting is direct DOM manipulation
  useEffect(() => {
    const loop = () => {
      const { ct, pt, playing } = audioSnapRef.current;
      const t = playing ? ct + (performance.now() - pt) / 1000 : ct;
      const lyr = lyricsDataRef.current;

      // Line detection — React re-render only when line changes
      const newIdx = lyr ? lyr.reduce((b, l, i) => l.time <= t ? i : b, -1) : -1;

      // Gap detection: if gap between line's endTime and next line's start > 3s, deactivate at endTime
      let displayIdx = newIdx;
      if (newIdx >= 0 && lyr) {
        const line = lyr[newIdx];
        if (line.endTime != null) {
          const nextStart = lyr[newIdx + 1]?.time ?? Infinity;
          if (nextStart - line.endTime > 3 && t >= line.endTime) displayIdx = -1;
        }
      }

      if (displayIdx !== lastIdxRef.current) {
        lastIdxRef.current = displayIdx;
        activeWordIdxRef.current = -1;
        wordElsRef.current = []; // cleared until useLayoutEffect repopulates after render
        setTick(n => n + 1);
      }

      // Word highlighting — direct DOM, bypasses React entirely (uses newIdx, not displayIdx)
      const lyrLine = lyr?.[newIdx];
      if (lyrLine?.wordSync && wordElsRef.current.length > 0) {
        const words = lyrLine.words.filter(w => !w.isSpace);
        let curWordIdx = -1;
        for (let wi = 0; wi < words.length; wi++) {
          if (t >= words[wi].time) curWordIdx = wi;
          else break;
        }
        // Update non-active words only on word change (cheap)
        if (curWordIdx !== activeWordIdxRef.current) {
          activeWordIdxRef.current = curWordIdx;
          const els = wordElsRef.current;
          for (let wi = 0; wi < els.length; wi++) {
            const el = els[wi];
            if (!el) continue;
            const dimEl = el.previousElementSibling;
            if (wi === curWordIdx) {
              // Fade-in: bright span was opacity=0 (future state) → animate to 1
              el.style.transition = "opacity 0.15s ease-out";
              el.style.opacity = "1";
            } else if (wi < curWordIdx) {
              // Past: keep bright span fully visible (same white as active)
              el.style.transition = "";
              el.style.WebkitMaskImage = "";
              el.style.maskImage = "";
              el.style.opacity = "1";
            } else {
              // Future: instant reset
              el.style.transition = "";
              el.style.opacity = "0";
              el.style.WebkitMaskImage = "linear-gradient(to right, black -6px, transparent 6px)";
              el.style.maskImage = "linear-gradient(to right, black -6px, transparent 6px)";
              if (dimEl) { dimEl.style.transition = ""; dimEl.style.color = "rgba(255,255,255,0.25)"; }
            }
          }
        }
        // Update active word mask every frame for smooth wipe (opacity handled by CSS transition)
        if (curWordIdx >= 0 && curWordIdx < wordElsRef.current.length) {
          const el = wordElsRef.current[curWordIdx];
          const word = words[curWordIdx];
          if (el && word) {
            const pct = Math.min(100, (t - word.time) / Math.max(word.end - word.time, 0.001) * 100);
            el.style.WebkitMaskImage = `linear-gradient(to right, black calc(${pct.toFixed(1)}% - 6px), transparent calc(${pct.toFixed(1)}% + 6px))`;
            el.style.maskImage = `linear-gradient(to right, black calc(${pct.toFixed(1)}% - 6px), transparent calc(${pct.toFixed(1)}% + 6px))`;
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // After React renders, cache word span elements for the active line
  useLayoutEffect(() => {
    const idx = lastIdxRef.current;
    if (idx >= 0) {
      const lineEl = document.querySelector(`[data-lyric-idx="${idx}"]`);
      wordElsRef.current = lineEl
        ? Array.from(lineEl.querySelectorAll("[data-word-bright]"))
        : [];
    } else {
      wordElsRef.current = [];
    }
  }, [tick]);

  // Sync isCustomLyrics to parent
  useEffect(() => { onCustomLyricsStatusChange?.(isCustomLyrics); }, [isCustomLyrics]); // eslint-disable-line react-hooks/exhaustive-deps

  // Import lyrics: open file dialog, read content, POST to backend
  const importCustomLyrics = async () => {
    if (!track?.videoId) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ filters: [{ name: "Lyrics", extensions: ["lrc", "ttml"] }], title: "Lyrics importieren" });
      if (!path) return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(path);
      const fmt = path.toLowerCase().endsWith(".ttml") ? "ttml" : "lrc";
      const r = await fetch(`${API}/lyrics/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: track.videoId, content, format: fmt }),
      });
      if (!r.ok) throw new Error("Speichern fehlgeschlagen");
      const parsed = fmt === "ttml" ? parseTtml(content) : parseLrc(content);
      setLyrics(parsed.length ? parsed : null);
      setSource("Custom");
      onSourceChange?.("Custom");
      setIsCustomLyrics(true);
      setLoading(false);
      onAddToast?.("Lyrics importiert", "success");
    } catch (e) {
      onAddToast?.("Import fehlgeschlagen", "error");
      console.error(e);
    }
  };

  // Remove custom lyrics
  const removeCustomLyrics = async () => {
    if (!track?.videoId) return;
    try {
      await fetch(`${API}/lyrics/custom/${track.videoId}`, { method: "DELETE" });
    } catch {}
    setIsCustomLyrics(false);
    setLyrics(null);
    setSource("");
    onSourceChange?.("");
    setLoading(true);
    // Trigger a fresh provider fetch by bumping a local key
    setCustomLyricsKey(k => k + 1);
  };

  // Expose functions via refs for parent
  useEffect(() => {
    if (importLyricsRef) importLyricsRef.current = importCustomLyrics;
    if (removeCustomLyricsRef) removeCustomLyricsRef.current = removeCustomLyrics;
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!track) return;
    setLoading(true);
    setLyrics(null);
    setIsCustomLyrics(false);

    const cacheKey = `kiyoshi-lyrics-${track.videoId}`;

    // Check for custom lyrics first
    fetch(`${API}/lyrics/custom/${track.videoId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.content) {
          const parsed = data.format === "ttml" ? parseTtml(data.content) : parseLrc(data.content);
          if (parsed.length) {
            setLyrics(parsed);
            setSource("Custom");
            onSourceChange?.("Custom");
            setIsCustomLyrics(true);
            setLoading(false);
            return;
          }
        }
        // No custom lyrics — proceed with normal fetch
        continueWithProviders();
      })
      .catch(() => continueWithProviders());

    function continueWithProviders() {
    // Forced provider: skip cache, fetch only that one provider
    if (forcedProvider) {
      const singleProviders = DEFAULT_LYRICS_PROVIDERS.map(p => ({ ...p, enabled: p.id === forcedProvider }));
      fetchLyrics(track.title, track.artists, track.album, parseDurationToSeconds(track.duration), singleProviders, track.videoId || "").then(res => {
        if (res?.lrc) { setLyrics(res.lrc); setSource(res.source); onSourceChange?.(res.source); }
        else { setLyrics(null); onSourceChange?.(""); onProviderFailed?.(forcedProvider); }
        setLoading(false);
      });
      return;
    }

    // Check localStorage cache first (keyed by videoId), skip if refetching
    if (refetchKey === 0) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          const { lrc, source } = parsed;
          setLyrics(lrc);
          setSource(source);
          onSourceChange?.(source);
          setLoading(false);
          if (Array.isArray(parsed.failedIds)) {
            // Already have availability info — use immediately
            parsed.failedIds.forEach(id => onProviderFailed?.(id));
          } else {
            // Old cache entry — check availability silently in background
            fetchLyrics(track.title, track.artists, track.album, parseDurationToSeconds(track.duration), providers, track.videoId || "").then(res => {
              const ids = res?.failedIds || [];
              ids.forEach(id => onProviderFailed?.(id));
              try { localStorage.setItem(cacheKey, JSON.stringify({ lrc, source, failedIds: ids })); } catch {}
            });
          }
          return;
        }
      } catch {}
    } else {
      // Clear stale cache before refetching
      try { localStorage.removeItem(cacheKey); } catch {}
    }

    fetchLyrics(track.title, track.artists, track.album, parseDurationToSeconds(track.duration), providers, track.videoId || "").then(res => {
      if (res?.lrc) {
        setLyrics(res.lrc);
        setSource(res.source);
        onSourceChange?.(res.source);
        try { localStorage.setItem(cacheKey, JSON.stringify({ lrc: res.lrc, source: res.source, failedIds: res.failedIds || [] })); } catch {}
      }
      // Mark providers that were tried but failed
      res?.failedIds?.forEach(id => onProviderFailed?.(id));
      setLoading(false);
    });
    } // end continueWithProviders
  }, [track, refetchKey, forcedProvider, customLyricsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeIdx = lastIdxRef.current;

  // Unique agents in order of first appearance (only when ≥2 distinct named agents)
  const lyricsAgents = useMemo(() => {
    if (!lyrics) return [];
    const seen = new Set();
    const result = [];
    for (const line of lyrics) {
      const key = line.agent?.id || line.agent?.name;
      if (key && line.agent.name && !seen.has(key)) {
        seen.add(key);
        result.push(line.agent);
      }
    }
    return result;
  }, [lyrics]);

  const activeAgent = lyrics?.[activeIdx]?.agent;

  useEffect(() => {
    if (activeIdx < 0 || !containerRef.current) return;
    const container = containerRef.current;
    const activeEl = container.querySelectorAll("[data-lyric]")[activeIdx];
    if (!activeEl) return;
    const containerHeight = container.clientHeight;
    const elTop = activeEl.offsetTop;
    const elHeight = activeEl.clientHeight;
    const target = elTop - containerHeight / 2 + elHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }, [activeIdx]);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      display: "flex", flexDirection: "column", overflow: "hidden",
      background: "#0d0d0d",
    }}>
      {/* Blurred background */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: track?.thumbnail ? `url(${track.thumbnail})` : "none",
        backgroundSize: "cover", backgroundPosition: "center",
        filter: "blur(40px) brightness(0.35)",
        transform: "scale(1.1)",
        animation: ambientVisualizer ? "ambientBreathe 12s ease-in-out infinite" : "none",
      }} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />

      {/* Ambient colour blobs — negative inset keeps edges outside the visible area */}
      {ambientVisualizer && (<>
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 1, pointerEvents: "none",
          background: "radial-gradient(ellipse 38% 30% at 44% 42%, var(--accent) 0%, transparent 70%)",
          mixBlendMode: "screen",
          animation: "blobDrift1 18s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 1, pointerEvents: "none",
          background: "radial-gradient(ellipse 32% 38% at 63% 61%, #7b2ff7 0%, transparent 68%)",
          mixBlendMode: "screen",
          animation: "blobDrift2 23s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", inset: "-30%", zIndex: 1, pointerEvents: "none",
          background: "radial-gradient(ellipse 44% 36% at 52% 46%, #1565c0 0%, transparent 65%)",
          mixBlendMode: "screen",
          animation: "blobDrift3 29s ease-in-out infinite",
        }} />
      </>)}

      {/* Source badge */}
      <div style={{ position: "absolute", bottom: 12, right: 16, zIndex: 2, display: "flex", alignItems: "center", gap: 6 }}>
        {source && <span style={{ fontSize: "var(--t10)", color: "var(--text-muted)", background: "rgba(255,255,255,0.08)", padding: "3px 8px", borderRadius: 10 }}>{source}</span>}
      </div>

      {/* Agent tags — bottom center, only when ≥2 named agents and toggle is on */}
      {showAgentTags && lyricsAgents.length >= 2 && (
        <div style={{
          position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
          zIndex: 2, display: "flex", gap: 8, pointerEvents: "none",
        }}>
          {lyricsAgents.map(agent => {
            const key = agent.id || agent.name;
            const isActive = (activeAgent?.id || activeAgent?.name) === key;
            return (
              <span key={key} className={isActive ? "agent-tag-active" : ""} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
                padding: "4px 12px", borderRadius: 8,
                background: isActive ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                color: isActive ? "#fff" : "rgba(255,255,255,0.3)",
                transition: "background 0.25s, color 0.25s",
                whiteSpace: "nowrap",
              }}>{agent.name}</span>
            );
          })}
        </div>
      )}

      {/* Lyrics */}
      <div ref={containerRef} className="scrollable" style={{
        position: "relative", zIndex: 1, flex: 1,
        overflowY: "auto", padding: "40vh 80px 40vh",
      }}>
        {loading && <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: 60 }}>{t("lyricsLoading")}</div>}
        {!loading && !lyrics && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 60 }}>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "var(--t14)" }}>{t("noLyrics")}</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "var(--t12)" }}>{t("noLyricsHint")}</div>
            <div style={{ display: "flex", gap: 10 }}>
              {/* Akari's LRC Maker */}
              <button
                onClick={() => openUrl("https://lrc-maker.github.io").catch(console.error)}
                style={{
                  background: "rgba(255,255,255,0.08)", border: "none",
                  borderRadius: 10, padding: "8px 16px", cursor: "pointer",
                  color: "#fff", fontSize: "var(--t13)", fontFamily: "var(--font)",
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.16)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              >
                <img src="/Akari's LRC Icon.svg" style={{ width: 26, height: 26 }} alt="" />
                {"Akari's LRC Maker"}
              </button>
              {/* Boidu's Composer */}
              <button
                onClick={() => openUrl("https://composer.boidu.dev").catch(console.error)}
                style={{
                  background: "rgba(255,255,255,0.08)", border: "none",
                  borderRadius: 10, padding: "8px 16px", cursor: "pointer",
                  color: "#fff", fontSize: "var(--t13)", fontFamily: "var(--font)",
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.16)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              >
                <img src="/Boidu Composer Icon.svg" style={{ width: 26, height: 26 }} alt="" />
                {"Boidu's Composer"}
              </button>
            </div>
            <button
              onClick={importCustomLyrics}
              style={{
                background: "rgba(255,255,255,0.06)", border: "none",
                borderRadius: 10, padding: "8px 20px", cursor: "pointer",
                color: "#fff", fontSize: "var(--t13)", fontFamily: "var(--font)",
                display: "flex", alignItems: "center", gap: 8,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            >
              <UploadSimple size={14} />
              {t("importLyrics")}
            </button>
          </div>
        )}
        {lyrics && lyrics.map((line, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          const isFuture = !isActive && !isPast;

          const lineText = line.wordSync
            ? line.words.map(w => w.text).join("")
            : (line.text || "\u00A0");


          let blur, opacity;
          if (isActive)     { blur = 0;   opacity = 1; }
          else if (isPast)  { blur = 3;   opacity = 0.4; }
          else              { blur = 0;   opacity = 0.35; }

          const seekable = line.time >= 0;
          const agentRole = line.agentRole; // "lead", "featured", "group", or null
          const textAlign = agentRole === "featured" ? "right" : agentRole === "group" ? "center" : "left";
          return (
            <div
              key={i}
              data-lyric="true"
              data-lyric-idx={i}
              onClick={seekable ? () => { audioRef.current.currentTime = line.time; } : undefined}
              onMouseEnter={seekable ? e => { e.currentTarget.style.opacity = Math.min(1, opacity + 0.25); } : undefined}
              onMouseLeave={seekable ? e => { e.currentTarget.style.opacity = opacity; } : undefined}
              style={{
                fontSize: fontSize,
                fontWeight: 700,
                lineHeight: 1.5,
                marginBottom: 24,
                cursor: seekable ? "pointer" : "default",
                filter: `blur(${blur}px)`,
                opacity,
                transition: "filter 0.4s ease, opacity 0.4s ease",
                userSelect: "none",
                borderRadius: 8,
                padding: "2px 8px",
                margin: "0 -8px 24px",
                textAlign,
              }}
            >
              {isActive && line.wordSync ? (
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {line.words.map((word, wi) =>
                    word.isSpace
                      ? <span key={wi}>{word.text}</span>
                      : <span key={wi} style={{ position: "relative", display: "inline-block" }}>
                          <span style={{ color: "rgba(255,255,255,0.25)" }}>{word.text}</span>
                          <span
                            data-word-bright="true"
                            style={{
                              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                              color: "white",
                              opacity: 0,
                              WebkitMaskImage: "linear-gradient(to right, black -6px, transparent 6px)",
                              maskImage: "linear-gradient(to right, black -6px, transparent 6px)",
                              pointerEvents: "none",
                            }}
                          >{word.text}</span>
                        </span>
                  )}
                </span>
              ) : (
                <span style={{ color: "#fff" }}>{lineText}</span>
              )}
              {showRomaji && romajiLines?.[i] && (
                <div style={{
                  fontSize: romajiFontSize,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.55)",
                  opacity: isActive ? 1 : 0.6,
                  marginTop: 4,
                  lineHeight: 1.4,
                  textAlign,
                }}>{romajiLines[i]}</div>
              )}
              {showTranslation && translations?.[i] && translations[i] !== lineText && (
                <div style={{
                  fontSize: translationFontSize,
                  fontWeight: 600,
                  color: "var(--accent)",
                  opacity: isActive ? 0.9 : 0.45,
                  marginTop: 6,
                  lineHeight: 1.4,
                  textAlign,
                }}>{translations[i]}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridCard({ thumbnail, title, subtitle, onClick, onContextMenu }) {
  return (
    <div onClick={onClick} onContextMenu={onContextMenu} style={{
      cursor: "pointer", borderRadius: 8, overflow: "hidden",
      background: "var(--bg-surface)", transition: "transform 0.15s, background 0.15s",
    }}
    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-elevated)"}
    onMouseLeave={e => e.currentTarget.style.background = "var(--bg-surface)"}
    >
      <div style={{ width: "100%", aspectRatio: "1", background: "var(--bg-elevated)", overflow: "hidden" }}>
        {thumbnail
          ? <img src={thumb(thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontSize: "var(--t13)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function LibraryView({ onPlay, currentTrack, isPlaying, onOpenPlaylist, onOpenAlbum, onOpenArtist, onContextMenu }) {
  const [tab, setTab] = useState("playlists");
  const [playlists, setPlaylists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const t = useLang();

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener("kiyoshi-library-updated", handler);
    return () => window.removeEventListener("kiyoshi-library-updated", handler);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const endpoints = {
      playlists: `${API}/library/playlists`,
      albums: `${API}/library/albums`,
      artists: `${API}/library/artists`,
    };
    fetch(endpoints[tab])
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        if (tab === "playlists") setPlaylists(d.playlists || []);
        if (tab === "albums") setAlbums(d.albums || []);
        if (tab === "artists") setArtists(d.artists || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab, refreshKey]);

  const tabs = [
    { id: "playlists", label: t("filterPlaylists") },
    { id: "albums",    label: t("filterAlbums") },
    { id: "artists",   label: t("filterArtists") },
  ];

  const items = tab === "playlists" ? playlists : tab === "albums" ? albums : artists;

  return (
    <div style={{ padding: "24px 24px" }}>
      <div style={{ fontSize: "var(--t22)", fontWeight: 600, marginBottom: 20 }}>{t("library")}</div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {tabs.map(tab_ => (
          <button key={tab_.id} onClick={() => setTab(tab_.id)} style={{
            background: tab === tab_.id ? "var(--accent)" : "var(--bg-elevated)",
            color: tab === tab_.id ? "#fff" : "var(--text-secondary)",
            border: "none", borderRadius: 20, padding: "6px 16px",
            fontSize: "var(--t13)", cursor: "pointer", fontFamily: "var(--font)",
            transition: "all 0.15s",
          }}>{tab_.label}</button>
        ))}
      </div>

      {loading && <div style={{ color: "var(--text-secondary)" }}>{t("loadingDots")}</div>}
      {error && <div style={{ color: "#f44336" }}>{error}</div>}
      {!loading && !error && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 16,
        }}>
          {items.map((item, i) => {
            if (tab === "playlists") return (
              <GridCard key={i}
                thumbnail={item.thumbnail}
                title={item.title}
                subtitle={item.count ? `${item.count} ${t("songs")}` : ""}
                onClick={() => onOpenPlaylist(item)}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, item) : undefined}
              />
            );
            if (tab === "albums") return (
              <GridCard key={i}
                thumbnail={item.thumbnail}
                title={item.title}
                subtitle={`${item.artists}${item.year ? ` · ${item.year}` : ""}`}
                onClick={() => onOpenAlbum(item)}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, { ...item, type: "album" }) : undefined}
              />
            );
            if (tab === "artists") return (
              <GridCard key={i}
                thumbnail={item.thumbnail}
                title={item.artist}
                subtitle={item.songs ? `${item.songs} ${t("songs")}` : ""}
                onClick={() => onOpenArtist(item)}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, { ...item, title: item.artist, type: "artist" }) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}


// ─── Extract dominant color from image via Canvas ──────────────────────────
function useAccentColor(imageUrl) {
  const [color, setColor] = useState("40,40,60");
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 50;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 50, 50);
        const d = ctx.getImageData(0, 0, 50, 50).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < d.length; i += 16) {
          r += d[i]; g += d[i+1]; b += d[i+2]; count++;
        }
        r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count);
        setColor(`${r},${g},${b}`);
      } catch {}
    };
    img.src = imageUrl;
  }, [imageUrl]);
  return color;
}

// ─── Shared table row for playlist/liked views ─────────────────────────────
function TableRow({ track, index, isPlaying, onPlay, onOpenArtist, onOpenAlbum, isAlbum, onContextMenu, isCached, isDownloading, onDownload, isPremiumOnly }) {
  const anim = useAnimations();
  const t = useLang();
  const [hovered, setHovered] = useState(false);

  const linkStyle = {
    fontSize: "var(--t12)", color: "var(--text-secondary)", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.15s",
  };

  const row = (
    <div
      onClick={isPremiumOnly ? undefined : () => onPlay(track)}
      onContextMenu={(!isPremiumOnly && onContextMenu) ? (e) => { e.preventDefault(); onContextMenu(e, track); } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: isAlbum ? "minmax(0,2fr) minmax(0,1fr) 28px 48px" : "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 28px 48px",
        alignItems: "center", gap: 8,
        padding: "5px 16px", borderRadius: "var(--radius)",
        cursor: isPremiumOnly ? "default" : "pointer",
        background: isPlaying ? "rgba(224,64,251,0.08)" : hovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.15s",
        opacity: isPremiumOnly ? 0.4 : 1,
      }}
    >
      {/* Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0, overflow: "hidden", background: "var(--bg-elevated)", position: "relative" }}>
          {track.thumbnail
            ? <img src={thumb(track.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
          {isPlaying && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
              {anim ? [1,2,3].map(b => (
                <div key={b} style={{ width: 3, borderRadius: 2, background: "var(--accent)", animation: `eqBar${b} ${0.6+b*0.15}s ease-in-out infinite`, animationDelay: `${b*0.1}s` }} />
              )) : <Pause size={12} style={{ color: "var(--accent)" }} />}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--t13)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", color: isPlaying ? "var(--accent)" : "var(--text-primary)" }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{track.title}</span>
            {track.isExplicit && <ExplicitBadge />}
          </div>
        </div>
      </div>
      {/* Artist */}
      <div
        onClick={e => { if (track.artistBrowseId && onOpenArtist) { e.stopPropagation(); onOpenArtist({ browseId: track.artistBrowseId, artist: track.artists }); }}}
        style={{ ...linkStyle, cursor: track.artistBrowseId && onOpenArtist ? "pointer" : "default" }}
        onMouseEnter={e => { if (track.artistBrowseId && onOpenArtist) e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary)"}
      >
        {track.artists || "—"}
      </div>
      {/* Album */}
      {!isAlbum && (
        <div
          onClick={e => { if (track.albumBrowseId && onOpenAlbum) { e.stopPropagation(); onOpenAlbum({ browseId: track.albumBrowseId, title: track.album }); }}}
          style={{ ...linkStyle, cursor: track.albumBrowseId && onOpenAlbum ? "pointer" : "default" }}
          onMouseEnter={e => { if (track.albumBrowseId && onOpenAlbum) e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary)"}
        >
          {track.album || "—"}
        </div>
      )}
      {/* Download */}
      <div style={{ display: "flex", justifyContent: "center" }}
        onClick={e => { e.stopPropagation(); if (!isPremiumOnly && onDownload && !isCached && !isDownloading) onDownload(track); }}
      >
        {isPremiumOnly ? (
          <Crown size={14} weight="fill" style={{ color: "#f0b429" }} />
        ) : isCached ? (
          <CheckCircle size={14} style={{ color: "#4caf50" }} />
        ) : isDownloading ? (
          <DownloadSimple size={14} style={{ color: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
        ) : onDownload && hovered ? (
          <DownloadSimple size={14} style={{ color: "var(--text-muted)", cursor: "pointer" }} />
        ) : null}
      </div>
      {/* Duration */}
      <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", textAlign: "right" }}>
        {track.duration || "—"}
      </div>
    </div>
  );

  return isPremiumOnly
    ? <Tooltip text={t("premiumOnly")}>{row}</Tooltip>
    : row;
}

// ─── Shared playlist/collection layout ────────────────────────────────────
function PlaylistLayout({ title, thumbnail, tracks, total, loading, progress, cached, onPlay, currentTrack, isPlaying, onBack, isLiked, onOpenArtist, onOpenAlbum, isAlbum, albumArtists, albumArtistBrowseId, year, onRefresh, onTrackContextMenu, cachedSongIds, downloadingIds, premiumSongIds, onDownloadSong, onDownloadAll, onRemoveAll, hideExplicit }) {
  const accentColor = useAccentColor(thumbnail);
  const t = useLang();
  const [trackSearch, setTrackSearch] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (searchVisible) searchInputRef.current?.focus();
  }, [searchVisible]);

  const visibleTracks = tracks.filter(tr => {
    if (hideExplicit && tr.isExplicit) return false;
    if (trackSearch.trim()) {
      const q = trackSearch.toLowerCase();
      return (tr.title || "").toLowerCase().includes(q) || (tr.artists || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalDuration = formatTotalDuration(tracks);
  const skeletonCount = total ? Math.max(0, total - tracks.length) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>

      {/* Hero header */}
      <div style={{
        position: "relative", padding: "86px 28px 28px",
        background: `linear-gradient(to bottom, rgba(${accentColor},0.55) 0%, rgba(${accentColor},0.15) 60%, transparent 100%)`,
        transition: "background 0.6s ease",
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            position: "absolute", top: 44, left: 16, zIndex: 10,
            background: "rgba(0,0,0,0.4)", border: "none", borderRadius: "50%",
            width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#fff", backdropFilter: "blur(8px)",
          }}>
            <ArrowLeft size={18} />
          </button>
        )}
        <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
          {/* Cover */}
          <div style={{
            width: 180, height: 180, borderRadius: 10, flexShrink: 0,
            overflow: "hidden", background: "var(--bg-elevated)",
            boxShadow: `0 16px 48px rgba(${accentColor},0.35)`,
          }}>
            {isLiked && !thumbnail
              ? <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, rgba(${accentColor},0.8), rgba(${accentColor},0.3))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Heart size={72} weight="fill" style={{ color: "rgba(255,255,255,0.9)" }} />
                </div>
              : thumbnail
              ? <img src={thumb(thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
          </div>
          {/* Info */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--t11)", fontWeight: 500, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{isAlbum ? t("album") : t("playlist")}</div>
            <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.1, marginBottom: 12, color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}>{title}</div>
            <div style={{ fontSize: "var(--t13)", color: "rgba(255,255,255,0.7)", marginBottom: 16, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {isAlbum && albumArtists && (
                <span
                  onClick={() => albumArtistBrowseId && onOpenArtist?.({ browseId: albumArtistBrowseId, artist: albumArtists })}
                  style={{ cursor: albumArtistBrowseId ? "pointer" : "default", fontWeight: 600, color: "#fff", transition: "opacity 0.15s" }}
                  onMouseEnter={e => { if (albumArtistBrowseId) e.currentTarget.style.opacity = "0.7"; }}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                >{albumArtists}</span>
              )}
              {isAlbum && year && <span>· {year}</span>}
              {isAlbum && <span>· {total || tracks.length} {t("songs")}</span>}
              {!isAlbum && <span>{total || tracks.length} {t("songs")}</span>}
              {totalDuration && <span>· {totalDuration}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => tracks.length && onPlay(tracks[0], tracks)} style={{
                background: "var(--accent)", border: "none", borderRadius: "50%",
                width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.3)", transition: "transform 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
              >
                <Play size={16} style={{ color: "white" }} />
              </button>
              {onDownloadAll && tracks.length > 0 && (() => {
                const allCached = cachedSongIds && tracks.every(tr => cachedSongIds.has(tr.videoId));
                const someDownloading = downloadingIds && tracks.some(tr => downloadingIds.has(tr.videoId));
                return allCached ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      borderRadius: 20, height: 36, display: "flex", alignItems: "center",
                      padding: "0 14px", gap: 6, fontSize: "var(--t12)", fontWeight: 500,
                      color: "#4caf50", background: "rgba(76,175,80,0.12)", border: "0.5px solid rgba(76,175,80,0.3)",
                    }}>
                      <CheckCircle size={14} weight="fill" />
                      {t("downloaded")}
                    </div>
                    {onRemoveAll && (
                      <Tooltip text={t("removeDownload")}><button
                        onClick={() => onRemoveAll(tracks)}
                        style={{
                          background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.2)",
                          borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
                          justifyContent: "center", cursor: "pointer", transition: "background 0.15s",
                          color: "rgba(255,255,255,0.7)", padding: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(224,82,82,0.25)"; e.currentTarget.style.color = "#e05252"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
                      >
                        <Trash size={14} />
                      </button></Tooltip>
                    )}
                  </div>
                ) : (
                  <Tooltip text={t("downloadAll")}><button
                    onClick={() => onDownloadAll(tracks)}
                    disabled={someDownloading}
                    style={{
                      background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.2)",
                      borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
                      justifyContent: "center", cursor: someDownloading ? "default" : "pointer", transition: "background 0.15s",
                      color: "rgba(255,255,255,0.8)", padding: 0,
                      opacity: someDownloading ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!someDownloading) e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
                    onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                  >
                    {someDownloading ? <DownloadSimple size={14} style={{ animation: "pulse 1s ease-in-out infinite" }} /> : <DownloadSimple size={14} />}
                  </button></Tooltip>
                );
              })()}
              {cached && onRefresh && (
                <Tooltip text={t("refresh")}><button
                  onClick={onRefresh}
                  style={{
                    background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.2)",
                    borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
                    justifyContent: "center", cursor: "pointer", transition: "background 0.15s, transform 0.15s",
                    color: "rgba(255,255,255,0.8)",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; e.currentTarget.style.transform = "rotate(30deg)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.transform = "rotate(0deg)"; }}
                >
                  <ArrowClockwise size={14} />
                </button></Tooltip>
              )}
              {/* Search toggle */}
              <Tooltip text={t("searchInPlaylist")}><button
                onClick={() => { setSearchVisible(v => !v); if (searchVisible) setTrackSearch(""); }}
                style={{
                  background: searchVisible ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.1)",
                  border: "0.5px solid rgba(255,255,255,0.2)",
                  borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer", transition: "background 0.15s",
                  color: "rgba(255,255,255,0.8)",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.22)"}
                onMouseLeave={e => e.currentTarget.style.background = searchVisible ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.1)"}
              >
                <MagnifyingGlass size={14} />
              </button></Tooltip>
              {/* Inline search input — slides in next to buttons */}
              <div style={{
                width: searchVisible ? 220 : 0, overflow: "hidden",
                transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <input
                  ref={searchInputRef}
                  value={trackSearch}
                  onChange={e => setTrackSearch(e.target.value)}
                  placeholder={t("searchInPlaylist")}
                  style={{
                    background: "rgba(0,0,0,0.35)", border: "0.5px solid rgba(255,255,255,0.2)",
                    borderRadius: 20, padding: "7px 14px", fontSize: "var(--t13)", color: "#fff",
                    outline: "none", width: 220, flexShrink: 0, fontFamily: "var(--font)",
                  }}
                />
              </div>
              {searchVisible && trackSearch && (
                <span style={{ fontSize: "var(--t12)", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>
                  {visibleTracks.length} {t("xOfY")} {tracks.length}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loading progress */}
      {loading && !cached && (
        <div style={{ padding: "0 28px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: "var(--t11)", color: "var(--text-muted)" }}>{t("fetchingSongs")}</span>
            <span style={{ fontSize: "var(--t11)", color: "var(--accent)", fontWeight: 500 }}>{progress}%</span>
          </div>
          <div style={{ height: 3, background: "var(--bg-elevated)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg,var(--accent),#c020e0)", width: `${progress}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: isAlbum ? "minmax(0,2fr) minmax(0,1fr) 28px 48px" : "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 28px 48px",
        gap: 8, padding: "8px 16px", margin: "0 12px",
        borderBottom: "0.5px solid var(--border)",
        fontSize: "var(--t11)", fontWeight: 500, color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.07em",
      }}>
        <div>{t("colTitle")}</div>
        <div>{t("colArtist")}</div>
        {!isAlbum && <div>{t("colAlbum")}</div>}
        <div></div>
        <div style={{ textAlign: "right" }}>{t("colDuration")}</div>
      </div>

      {/* Track list */}
      <div style={{ padding: "8px 12px 32px" }}>
        {visibleTracks.map((tr, i) => (
          <TableRow key={`${i}-${tr.videoId}`} track={tr} index={i}
            isPlaying={isPlaying && currentTrack?.videoId === tr.videoId}
            onPlay={() => onPlay(tr, visibleTracks)}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            isAlbum={isAlbum}
            onContextMenu={onTrackContextMenu}
            isCached={cachedSongIds?.has(tr.videoId)}
            isDownloading={downloadingIds?.has(tr.videoId)}
            isPremiumOnly={premiumSongIds?.has(tr.videoId)}
            onDownload={onDownloadSong}
          />
        ))}
        {!trackSearch && Array.from({ length: skeletonCount }).map((_, i) => <SkeletonRow key={`sk-${i}`} />)}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "8px 16px", borderRadius: "var(--radius)",
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 6, background: "var(--bg-elevated)", flexShrink: 0,
        animation: "pulse 1.4s ease-in-out infinite" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ height: 12, width: "45%", borderRadius: 4, background: "var(--bg-elevated)",
          animation: "pulse 1.4s ease-in-out infinite" }} />
        <div style={{ height: 10, width: "30%", borderRadius: 4, background: "var(--bg-elevated)",
          animation: "pulse 1.4s ease-in-out 0.2s infinite" }} />
      </div>
      <div style={{ height: 10, width: 36, borderRadius: 4, background: "var(--bg-elevated)",
        animation: "pulse 1.4s ease-in-out infinite" }} />
    </div>
  );
}

function DownloadsView({ onPlay, currentTrack, isPlaying, cachedSongIds, downloadingIds, premiumSongIds, onDownloadSong, onTrackContextMenu, hideExplicit }) {
  const t = useLang();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    const load = (attempt = 0) => {
      fetch(`${API}/song/cached/list`)
        .then(r => r.json())
        .then(d => { if (!cancelled) { setSongs(d.songs || []); setLoading(false); } })
        .catch(() => {
          if (!cancelled && attempt < 20) setTimeout(() => load(attempt + 1), 1500);
          else if (!cancelled) setLoading(false);
        });
    };
    load();
    return () => { cancelled = true; };
  }, [cachedSongIds.size]);

  return (
    <PlaylistLayout
      title={t("downloads")}
      thumbnail={null}
      tracks={songs}
      total={songs.length}
      loading={loading}
      progress={1}
      cached={false}
      onPlay={onPlay}
      currentTrack={currentTrack}
      isPlaying={isPlaying}
      onBack={null}
      onTrackContextMenu={onTrackContextMenu}
      cachedSongIds={cachedSongIds}
      downloadingIds={downloadingIds}
      premiumSongIds={premiumSongIds}
      onDownloadSong={onDownloadSong}
      onDownloadAll={null}
      onRemoveAll={null}
      hideExplicit={hideExplicit}
    />
  );
}

function CollectionView({ title, thumbnail, tracks, total, loading, progress, cached, onPlay, currentTrack, isPlaying, onBack, onOpenArtist, onOpenAlbum, isAlbum, albumArtists, albumArtistBrowseId, year, onRefresh, onTrackContextMenu, cachedSongIds, downloadingIds, premiumSongIds, onDownloadSong, onDownloadAll, onRemoveAll, hideExplicit }) {
  return (
    <PlaylistLayout
      title={title} thumbnail={thumbnail} tracks={tracks} total={total}
      loading={loading} progress={progress} cached={cached}
      onPlay={onPlay} currentTrack={currentTrack} isPlaying={isPlaying}
      onBack={onBack} onOpenArtist={onOpenArtist} onOpenAlbum={onOpenAlbum}
      isAlbum={isAlbum} albumArtists={albumArtists} albumArtistBrowseId={albumArtistBrowseId} year={year}
      onRefresh={onRefresh} onTrackContextMenu={onTrackContextMenu}
      cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} premiumSongIds={premiumSongIds} onDownloadSong={onDownloadSong} onDownloadAll={onDownloadAll} onRemoveAll={onRemoveAll}
      hideExplicit={hideExplicit}
    />
  );
}

function SearchView({ query, onPlay, currentTrack, isPlaying, onOpenArtist, onOpenAlbum, onOpenPlaylist, onContextMenu, onTrackContextMenu }) {
  const [filter, setFilter] = useState("songs");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const t = useLang();

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    setError(null);
    setResults([]);
    fetch(`${API}/search?q=${encodeURIComponent(query)}&filter=${filter}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setResults(d.results || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [query, filter]);

  const tabs = [
    { id: "songs",   label: t("filterSongs") },
    { id: "artists", label: t("filterArtists") },
    { id: "albums",  label: t("filterAlbums") },
  ];

  if (!query) return (
    <div style={{ padding: 28, color: "var(--text-secondary)" }}>
      {t("searchPrompt")}
    </div>
  );

  return (
    <div style={{ padding: "20px 12px" }}>
      {/* Header */}
      <div style={{ padding: "0 16px", marginBottom: 16 }}>
        <div style={{ fontSize: "var(--t18)", fontWeight: 500, marginBottom: 12 }}>
          {t("searchResultsFor")} „{query}"
        </div>
        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8 }}>
          {tabs.map(tab_ => (
            <button key={tab_.id} onClick={() => setFilter(tab_.id)} style={{
              background: filter === tab_.id ? "var(--accent)" : "var(--bg-elevated)",
              color: filter === tab_.id ? "#fff" : "var(--text-secondary)",
              border: "none", borderRadius: 20, padding: "6px 16px",
              fontSize: "var(--t13)", cursor: "pointer", fontFamily: "var(--font)",
              transition: "all 0.15s",
            }}>{tab_.label}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: "0 16px", color: "var(--text-secondary)" }}>{t("loadingDots")}</div>}
      {error && <div style={{ padding: "0 16px", color: "#f44336" }}>{t("errorLoading")}: {error}</div>}
      {!loading && !error && results.length === 0 && (
        <div style={{ padding: "0 16px", color: "var(--text-muted)" }}>{t("noResults")}</div>
      )}

      {/* Songs */}
      {filter === "songs" && results.map(song => (
        <TrackRow
          key={song.videoId}
          track={song}
          isPlaying={isPlaying && currentTrack?.videoId === song.videoId}
          onPlay={() => onPlay(song, results)}
          onOpenArtist={onOpenArtist}
          onContextMenu={onTrackContextMenu}
        />
      ))}

      {/* Artists */}
      {filter === "artists" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 16, padding: "0 16px",
        }}>
          {results.map((a, i) => (
            <div key={i} onClick={() => a.browseId && onOpenArtist?.({ browseId: a.browseId, artist: a.title })}
              style={{ cursor: "pointer", borderRadius: 8, padding: "12px 0", textAlign: "center" }}
              onMouseEnter={e => e.currentTarget.querySelector(".sr-title").style.color = "var(--accent)"}
              onMouseLeave={e => e.currentTarget.querySelector(".sr-title").style.color = "var(--text-primary)"}
            >
              <div style={{ width: 100, height: 100, borderRadius: "50%", overflow: "hidden", background: "var(--bg-elevated)", margin: "0 auto 10px" }}>
                {a.thumbnail
                  ? <img src={thumb(a.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
              </div>
              <div className="sr-title" style={{ fontSize: "var(--t13)", fontWeight: 500, transition: "color 0.15s", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
              {a.subtitle && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 3 }}>{a.subtitle}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Albums */}
      {filter === "albums" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 16, padding: "0 16px",
        }}>
          {results.map((a, i) => (
            <GridCard key={i}
              thumbnail={a.thumbnail}
              title={a.title}
              subtitle={`${a.artists}${a.year ? ` · ${a.year}` : ""}`}
              onClick={() => a.browseId && onOpenAlbum?.({ browseId: a.browseId, title: a.title, thumbnail: a.thumbnail })}
              onContextMenu={a.browseId ? (e) => onContextMenu?.(e, { browseId: a.browseId, title: a.title, thumbnail: a.thumbnail, type: "album" }) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HomeView({ displayName, onPlay, onOpenPlaylist, onOpenAlbum, onOpenArtist, onContextMenu, onTrackContextMenu }) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chips, setChips] = useState([]);
  const [activeChip, setActiveChip] = useState(null);
  const [moodPlaylists, setMoodPlaylists] = useState([]);
  const [moodLoading, setMoodLoading] = useState(false);
  const t = useLang();

  useEffect(() => {
    fetch(`${API}/home`)
      .then(r => r.json())
      .then(d => { setSections(d.sections || []); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${API}/mood/categories`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setChips(d.slice(0, 12)); })
      .catch(() => {});
  }, []);

  const handleChipClick = (chip) => {
    if (activeChip?.params === chip.params) {
      setActiveChip(null);
      setMoodPlaylists([]);
      return;
    }
    setActiveChip(chip);
    setMoodLoading(true);
    setMoodPlaylists([]);
    fetch(`${API}/mood/playlists?params=${encodeURIComponent(chip.params)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setMoodPlaylists(d); setMoodLoading(false); })
      .catch(() => setMoodLoading(false));
  };

  if (loading) return (
    <div style={{ padding: 28 }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ marginBottom: 36 }}>
          <div style={{ height: 14, width: 160, borderRadius: 4, background: "var(--bg-elevated)", marginBottom: 16, animation: "pulse 1.4s ease-in-out infinite" }} />
          <div style={{ display: "flex", gap: 16 }}>
            {[1,2,3,4,5].map(j => (
              <div key={j} style={{ flexShrink: 0, width: 160 }}>
                <div style={{ width: 160, height: 160, borderRadius: 10, background: "var(--bg-elevated)", marginBottom: 10, animation: "pulse 1.4s ease-in-out infinite" }} />
                <div style={{ height: 12, width: "80%", borderRadius: 3, background: "var(--bg-elevated)", marginBottom: 6, animation: "pulse 1.4s ease-in-out infinite" }} />
                <div style={{ height: 10, width: "55%", borderRadius: 3, background: "var(--bg-elevated)", animation: "pulse 1.4s ease-in-out infinite" }} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>
    </div>
  );

  if (!sections.length) return (
    <div style={{ padding: 28, color: "var(--text-muted)", fontSize: "var(--t13)" }}>{t("noSuggestions")}</div>
  );

  const { greeting, GreetingIcon } = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return { greeting: t("goodMorning"), GreetingIcon: SunHorizon };
    if (h >= 11 && h < 13) return { greeting: t("goodDay"),     GreetingIcon: Sun };
    if (h >= 13 && h < 18) return { greeting: t("goodAfternoon"), GreetingIcon: CloudSun };
    if (h >= 18 && h < 23) return { greeting: t("goodEvening"), GreetingIcon: Moon };
    return { greeting: t("goodNight"), GreetingIcon: MoonStars };
  })();

  return (
    <div style={{ padding: "0 0 28px 0" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}
        .carousel::-webkit-scrollbar{height:8px}
        .carousel::-webkit-scrollbar-track{background:transparent}
        .carousel::-webkit-scrollbar-thumb{background-color:var(--bg-elevated);border-radius:4px;border:2.5px solid transparent;background-clip:content-box}
        .home-card:hover .home-card-play{opacity:1!important}
        .home-card:hover .home-card-img{transform:scale(1.04)}
      `}</style>

      {/* ── Gradient header ── */}
      <div style={{ position: "relative", padding: "56px 28px 36px", overflow: "hidden", marginBottom: 8 }}>
        {/* Accent gradient fading out downward */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, var(--accent), transparent)", opacity: 0.18, pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <GreetingIcon size={36} weight="duotone" style={{ color: "var(--accent)", flexShrink: 0 }} />
          <h1 style={{ fontSize: "var(--t22)", fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
            {greeting}
            {displayName && (
              <>{", "}<span style={{ color: "var(--accent)" }}>{displayName}</span></>
            )}
          </h1>
        </div>
      </div>

      {/* ── Mood chips ── */}
      {chips.length > 0 && (
        <div className="carousel" style={{ display: "flex", gap: 8, overflowX: "auto", paddingLeft: 28, paddingRight: 28, paddingBottom: 4, marginBottom: 24 }}>
          {chips.map((chip, i) => {
            const isActive = activeChip?.params === chip.params;
            return (
              <button key={i} onClick={() => handleChipClick(chip)} style={{
                flexShrink: 0, padding: "7px 16px", borderRadius: 20,
                fontSize: "var(--t13)", fontWeight: isActive ? 700 : 500,
                border: "none", cursor: "pointer", fontFamily: "var(--font)",
                background: isActive ? "var(--accent)" : "var(--bg-elevated)",
                color: isActive ? "#fff" : "var(--text-secondary)",
                transition: "background 0.15s, color 0.15s",
              }}>{chip.title}</button>
            );
          })}
        </div>
      )}

      {/* ── Mood playlist results ── */}
      {activeChip && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: "var(--t16)", fontWeight: 700, paddingLeft: 28, paddingRight: 28, marginBottom: 16 }}>{activeChip.title}</div>
          {moodLoading
            ? <div style={{ display: "flex", gap: 16, paddingLeft: 28, paddingRight: 28 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ flexShrink: 0, width: 160 }}>
                    <div style={{ width: 160, height: 160, borderRadius: 10, background: "var(--bg-elevated)", animation: "pulse 1.4s ease-in-out infinite" }} />
                    <div style={{ height: 12, width: "75%", borderRadius: 3, background: "var(--bg-elevated)", marginTop: 10, animation: "pulse 1.4s ease-in-out infinite" }} />
                  </div>
                ))}
              </div>
            : <div className="carousel" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 10, paddingLeft: 28, paddingRight: 28 }}>
                {moodPlaylists.map((pl, i) => (
                  <div key={i} className="home-card" onClick={() => onOpenPlaylist({ playlistId: pl.playlistId, title: pl.title, thumbnail: pl.thumbnail })}
                    onContextMenu={e => onContextMenu?.(e, { playlistId: pl.playlistId, title: pl.title, thumbnail: pl.thumbnail })}
                    style={{ flexShrink: 0, width: 160, cursor: "pointer" }}>
                    <div style={{ position: "relative", marginBottom: 10, borderRadius: 10, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.35)" }}>
                      <div style={{ width: 160, height: 160, background: "var(--bg-elevated)" }}>
                        {pl.thumbnail
                          ? <img className="home-card-img" src={thumb(pl.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.25s" }} />
                          : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />
                        }
                      </div>
                      <div className="home-card-play" style={{ position: "absolute", inset: 0, opacity: 0, transition: "opacity 0.2s", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>
                          <Play size={18} weight="fill" style={{ color: "white", marginLeft: 2 }} />
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: "var(--t13)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</div>
                    {pl.subtitle && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.subtitle}</div>}
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {(() => {
        const sorted = [...sections].sort((a, b) => {
          const aAllSongs = (a.items || []).length > 0 && (a.items || []).every(x => x.type === "song");
          const bAllSongs = (b.items || []).length > 0 && (b.items || []).every(x => x.type === "song");
          return (bAllSongs ? 1 : 0) - (aAllSongs ? 1 : 0);
        });
        let quickPicksUsed = false;
        return sorted.map((section, si) => {
        const items = section.items || [];
        const isAllSongs = items.length > 0 && items.every(x => x.type === "song");
        if (isAllSongs && quickPicksUsed) return null;
        const allSongs = isAllSongs && !quickPicksUsed && (quickPicksUsed = true);

        /* ── Quick-Picks list-grid layout ── */
        if (allSongs) {
          const ROWS = 4;
          const columns = [];
          for (let i = 0; i < section.items.length; i += ROWS)
            columns.push(section.items.slice(i, i + ROWS));

          return (
            <div key={si} style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 28, paddingRight: 28, marginBottom: 14 }}>
                <span style={{ fontSize: "var(--t16)", fontWeight: 700 }}>{section.title}</span>
                <button onClick={() => onPlay(section.items[0], section.items)} style={{
                  fontSize: "var(--t12)", fontWeight: 600, color: "var(--accent)",
                  background: "rgba(var(--accent-rgb,180,100,255),0.12)", border: "none",
                  borderRadius: 20, padding: "5px 14px", cursor: "pointer", fontFamily: "var(--font)",
                }}>{t("playAll")}</button>
              </div>
              <div className="carousel" style={{ display: "flex", gap: 2, overflowX: "auto", paddingBottom: 10, paddingLeft: 28, paddingRight: 28 }}>
                {columns.map((col, ci) => (
                  <div key={ci} style={{ flexShrink: 0, width: 380, paddingRight: 16, marginRight: 16 }}>
                    {col.map((item, ri) => (
                      <div key={ri} onClick={() => onPlay(item, section.items)}
                        onContextMenu={e => { e.preventDefault(); onTrackContextMenu?.(e, item); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", cursor: "pointer", borderBottom: "none" }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
                        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                      >
                        <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "var(--bg-elevated)" }}>
                          {item.thumbnail
                            ? <img src={thumb(item.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />
                          }
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "var(--t13)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
                            {item.isExplicit && <ExplicitBadge />}
                          </div>
                          <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{item.artists}</div>
                        </div>
                        <div onClick={e => { e.stopPropagation(); onTrackContextMenu?.(e, item); }}
                          style={{ flexShrink: 0, padding: "4px 2px", color: "var(--text-secondary)", cursor: "pointer" }}>
                          <DotsThreeVertical size={16} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        /* ── Normal card carousel layout ── */
        return (
        <div key={si} style={{ marginBottom: 40 }}>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16, paddingLeft: 28, paddingRight: 28 }}>
            <span style={{ fontSize: "var(--t16)", fontWeight: 700, color: "var(--text-primary)" }}>{section.title}</span>
          </div>

          {/* Carousel */}
          <div className="carousel" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 10, paddingLeft: 28, paddingRight: 28 }}>
            {items.map((item, ii) => {
              const isSong   = item.type === "song";
              const isArtist = item.type === "artist";
              const subtitle = isSong ? item.artists : item.subtitle;
              const CARD_SIZE = 160;

              const handleClick = () => {
                if (isSong) {
                  const songsInSection = section.items.filter(x => x.type === "song");
                  onPlay(item, songsInSection);
                } else if (item.type === "playlist") {
                  onOpenPlaylist({ playlistId: item.playlistId, title: item.title, thumbnail: item.thumbnail });
                } else if (item.type === "album") {
                  onOpenAlbum({ browseId: item.browseId, title: item.title, thumbnail: item.thumbnail });
                } else if (isArtist) {
                  onOpenArtist({ browseId: item.browseId, artist: item.title });
                }
              };

              const contextItem = (item.type === "playlist")
                ? { playlistId: item.playlistId, title: item.title, thumbnail: item.thumbnail }
                : (item.type === "album")
                ? { browseId: item.browseId, title: item.title, thumbnail: item.thumbnail, type: "album" }
                : isArtist
                ? { browseId: item.browseId, title: item.title, thumbnail: item.thumbnail, type: "artist" }
                : null;

              const handlePlayDirect = (e) => {
                e.stopPropagation();
                if (item.type === "album") {
                  fetch(`${API}/album/${item.browseId}`)
                    .then(r => r.json())
                    .then(d => { if (d.tracks?.length) onPlay(d.tracks[0], d.tracks); })
                    .catch(() => {});
                } else if (item.type === "playlist") {
                  const es = new EventSource(`${API}/playlist/${item.playlistId}/stream`);
                  es.onmessage = (ev) => {
                    try {
                      const msg = JSON.parse(ev.data);
                      if (msg.type === "tracks" && msg.tracks?.length) {
                        onPlay(msg.tracks[0], msg.tracks);
                        es.close();
                      } else if (msg.type === "done" || msg.type === "error") {
                        es.close();
                      }
                    } catch { es.close(); }
                  };
                  es.onerror = () => es.close();
                } else {
                  handleClick();
                }
              };

              return (
                <div key={ii} className="home-card" onClick={handleClick}
                  onContextMenu={isSong
                    ? (e) => { e.preventDefault(); onTrackContextMenu?.(e, item); }
                    : (contextItem ? (e) => onContextMenu?.(e, contextItem) : undefined)}
                  style={{ flexShrink: 0, width: CARD_SIZE, cursor: "pointer" }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    position: "relative", marginBottom: 10,
                    borderRadius: isArtist ? "50%" : 10, overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                  }}>
                    <div style={{ width: CARD_SIZE, height: CARD_SIZE, background: "var(--bg-elevated)" }}>
                      {item.thumbnail
                        ? <img className="home-card-img" src={thumb(item.thumbnail)} alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.25s" }} />
                        : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />
                      }
                    </div>
                    {/* Play overlay — songs, playlists, albums only */}
                    {!isArtist && (
                      <div className="home-card-play" style={{
                        position: "absolute", inset: 0, opacity: 0, transition: "opacity 0.2s",
                        background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
                        pointerEvents: "none",
                      }}>
                        <div onClick={handlePlayDirect} style={{
                          width: 44, height: 44, borderRadius: "50%", background: "var(--accent)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          pointerEvents: "auto", cursor: "pointer",
                          boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                        }}>
                          <Play size={18} weight="fill" style={{ color: "white", marginLeft: 2 }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Title */}
                  <div style={{ fontSize: "var(--t13)", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4, overflow: "hidden",
                    textAlign: isArtist ? "center" : "left" }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, width: "100%" }}>{item.title}</span>
                    {isSong && item.isExplicit && <ExplicitBadge />}
                  </div>

                  {/* Subtitle */}
                  {subtitle
                    ? <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        textAlign: isArtist ? "center" : "left" }}>{subtitle}</div>
                    : isArtist && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 3, textAlign: "center" }}>Artist</div>
                  }
                </div>
              );
            })}
          </div>
        </div>
        );
        });
      })()}
    </div>
  );
}

function timeAgo(ts, t) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return t("justNow")    || "Gerade eben";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`;
  return new Date(ts).toLocaleDateString();
}

function HistoryView({ onPlay, currentTrack, isPlaying, onOpenArtist, onOpenAlbum, onTrackContextMenu, cachedSongIds, downloadingIds, onDownloadSong }) {
  const t = useLang();
  const profileKey = () => `kiyoshi-history-${window.__activeProfile || "default"}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(profileKey()) || "[]"); } catch { return []; } };
  const [tracks, setTracks] = useState(load);
  const [historyCtx, setHistoryCtx] = useState(null); // { x, y, track, index }

  useEffect(() => {
    const sync = () => setTracks(load());
    window.addEventListener("kiyoshi-history-updated", sync);
    return () => window.removeEventListener("kiyoshi-history-updated", sync);
  }, []);

  const clearHistory = () => {
    localStorage.removeItem(profileKey());
    setTracks([]);
  };

  const removeFromHistory = (index) => {
    const updated = [...tracks];
    updated.splice(index, 1);
    localStorage.setItem(profileKey(), JSON.stringify(updated));
    setTracks(updated);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "24px 24px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ fontSize: "var(--t22)", fontWeight: 700 }}>{t("history")}</div>
        {tracks.length > 0 && (
          <button onClick={clearHistory} style={{
            background: "none", border: "0.5px solid var(--border)", borderRadius: 8,
            color: "var(--text-muted)", fontSize: "var(--t12)", padding: "5px 12px", cursor: "pointer",
            fontFamily: "var(--font)", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#f44336"; e.currentTarget.style.borderColor = "#f44336"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >{t("clearHistory")}</button>
        )}
      </div>

      {tracks.length === 0 ? (
        <div style={{ padding: "40px 24px", color: "var(--text-muted)", fontSize: "var(--t13)", textAlign: "center" }}>
          {t("historyEmpty")}
        </div>
      ) : (
        <div className="scrollable" style={{ flex: 1, overflowY: "auto" }}>
          {tracks.map((track, i) => {
            const isActive = currentTrack?.videoId === track.videoId;
            return (
              <div key={`${track.videoId}-${i}`} onClick={() => onPlay(track, tracks)}
                onContextMenu={e => {
                  e.preventDefault();
                  onTrackContextMenu(e, track, { historyIndex: i, removeFromHistory: () => removeFromHistory(i) });
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "7px 24px", cursor: "pointer",
                  background: isActive ? "rgba(224,64,251,0.07)" : "transparent",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Thumbnail */}
                <div style={{ width: 40, height: 40, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "var(--bg-elevated)" }}>
                  {track.thumbnail
                    ? <img src={thumb(track.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--t13)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{track.title}</span>
                    {track.isExplicit && <ExplicitBadge />}
                  </div>
                  <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artists}</div>
                </div>
                {/* Time ago */}
                <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", flexShrink: 0 }}>{timeAgo(track.playedAt, t)}</div>
                {/* Duration */}
                <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{track.duration || ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LikedView({ onPlay, currentTrack, isPlaying, onOpenArtist, onOpenAlbum, onTrackContextMenu, cachedSongIds, downloadingIds, onDownloadSong, hideExplicit }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const t = useLang();

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/liked`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setTracks(d.tracks || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: 28, color: "var(--text-secondary)" }}>
      {t("loadingLikedSongs")}
    </div>
  );

  if (error) return (
    <div style={{ padding: 28 }}>
      <div style={{ color: "#f44336", marginBottom: 8 }}>{t("errorLoading")}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--t13)" }}>{error}</div>
      <div style={{ color: "var(--text-muted)", fontSize: "var(--t12)", marginTop: 12 }}>
        {t("backendHint")} <code style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: 4 }}>python server.py</code>
      </div>
    </div>
  );

  return (
    <PlaylistLayout
      title={t("likedSongs")} thumbnail={null} tracks={tracks} total={tracks.length}
      loading={false} progress={0} cached={false}
      onPlay={onPlay} currentTrack={currentTrack} isPlaying={isPlaying}
      onBack={null} isLiked={true} onOpenArtist={onOpenArtist} onOpenAlbum={onOpenAlbum}
      onTrackContextMenu={onTrackContextMenu}
      cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} onDownloadSong={onDownloadSong}
      hideExplicit={hideExplicit}
    />
  );
}

function ArtistDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  const MAX = 180;
  const isLong = text.length > MAX;
  const displayed = expanded || !isLong ? text : text.slice(0, MAX).trimEnd() + "…";
  return (
    <div style={{ padding: "12px 24px 4px", borderBottom: "0.5px solid var(--border)" }}>
      <p style={{
        margin: 0, fontSize: "var(--t12)", lineHeight: 1.65,
        color: "var(--text-secondary)", whiteSpace: "pre-wrap",
      }}>{displayed}</p>
      {isLong && (
        <button onClick={() => setExpanded(e => !e)} style={{
          marginTop: 6, background: "none", border: "none", cursor: "pointer",
          fontSize: "var(--t12)", color: "var(--accent)", padding: 0, fontFamily: "var(--font)",
        }}>{expanded ? "Weniger anzeigen" : "Mehr anzeigen"}</button>
      )}
    </div>
  );
}

function ArtistView({ browseId, onPlay, currentTrack, isPlaying, onOpenAlbum, onOpenPlaylist, onBack, onContextMenu, onTogglePin, isPinned }) {
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const t = useLang();
  const artistAccent = useAccentColor(artist?.thumbnail);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/artist/${browseId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setArtist(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [browseId]);

  if (loading) return (
    <div style={{ padding: 28 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>
      <div style={{ height: 200, borderRadius: 12, background: "var(--bg-elevated)", marginBottom: 24, animation: "pulse 1.4s ease-in-out infinite" }} />
      {[1,2,3,4,5].map(i => <div key={i} style={{ height: 52, borderRadius: 8, background: "var(--bg-elevated)", marginBottom: 8, animation: "pulse 1.4s ease-in-out infinite" }} />)}
    </div>
  );

  if (error) return <div style={{ padding: 28, color: "#f44336" }}>{error}</div>;
  if (!artist) return null;

  return (
    <div style={{ paddingBottom: 32 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>

      {/* Hero banner */}
      <div style={{ position: "relative", height: 260, overflow: "hidden" }}>
        {artist.thumbnail && (
          <img src={thumb(artist.thumbnail)} alt="" style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover",
            filter: "brightness(0.45)",
          }} />
        )}
        {!artist.thumbnail && (
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(135deg, rgba(${artistAccent},0.6), rgba(${artistAccent},0.2))`,
          }} />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, transparent 20%, var(--bg-base) 100%)",
        }} />
        <button onClick={onBack} style={{
          position: "absolute", top: 44, left: 16, zIndex: 10000,
          background: "rgba(0,0,0,0.4)", border: "none", borderRadius: "50%",
          width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#fff", backdropFilter: "blur(8px)",
        }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ position: "absolute", bottom: 20, left: 24 }}>
          <div style={{ fontSize: "var(--t11)", fontWeight: 500, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t("artist")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
              {artist.name}
            </div>
            {onTogglePin && (
              <Tooltip text={t(isPinned ? "removeFromSidebar" : "pinToSidebar")}><button
                onClick={() => onTogglePin({ browseId, title: artist.name, thumbnail: artist.thumbnail, type: "artist" })}
                style={{
                  background: isPinned ? "var(--accent)" : "rgba(255,255,255,0.15)",
                  border: "none", borderRadius: "50%",
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#fff", flexShrink: 0,
                  transition: "background 0.2s", backdropFilter: "blur(8px)",
                }}
              >
                <PushPin size={15} weight={isPinned ? "fill" : "regular"} />
              </button></Tooltip>
            )}
          </div>
          {artist.subscribers && (
            <div style={{ fontSize: "var(--t12)", color: "rgba(255,255,255,0.55)", marginTop: 6, fontWeight: 500 }}>
              {artist.subscribers}
            </div>
          )}
        </div>
      </div>

      {/* Artist description */}
      {artist.description && <ArtistDescription text={artist.description} />}

      <div style={{ padding: "0 24px" }}>

        {/* Top Songs */}
        {artist.tracks?.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 8 }}>
              <div style={{ fontSize: "var(--t16)", fontWeight: 600 }}>{t("topSongs")}</div>
              <div style={{ display: "flex", gap: 4 }}>
                {artist.songsBrowseId && (
                  <button
                    onClick={() => onOpenPlaylist({ playlistId: artist.songsBrowseId, title: `${artist.name} – ${t("topSongs")}`, forcedTitle: `${artist.name} – ${t("topSongs")}`, thumbnail: artist.thumbnail })}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: "var(--t12)", color: "var(--text-secondary)", padding: "4px 8px",
                      borderRadius: "var(--radius)", fontFamily: "var(--font)",
                      transition: "background 0.15s, color 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                  >{t("showAll")}</button>
                )}
                <button
                  onClick={() => onPlay(artist.tracks[0], artist.tracks)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "var(--t12)", color: "var(--accent)", padding: "4px 8px",
                    borderRadius: "var(--radius)", fontFamily: "var(--font)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >{t("playAll")}</button>
              </div>
            </div>
            <div style={{ margin: "0 -16px" }}>
              {artist.tracks.map((t, i) => (
                <TrackRow key={t.videoId || i} track={t}
                  isPlaying={isPlaying && currentTrack?.videoId === t.videoId}
                  onPlay={() => onPlay(t, artist.tracks)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Albums */}
        {artist.albums?.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 12 }}>{t("albums")}</div>
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
              {artist.albums.map((a, i) => (
                <div key={i} onClick={() => onOpenAlbum({ browseId: a.browseId, title: a.title, thumbnail: a.thumbnail })}
                  onContextMenu={e => onContextMenu?.(e, { browseId: a.browseId, title: a.title, thumbnail: a.thumbnail, type: "album" })}
                  style={{ flexShrink: 0, width: 148, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.querySelector(".album-title").style.color = "var(--accent)"}
                  onMouseLeave={e => e.currentTarget.querySelector(".album-title").style.color = "var(--text-primary)"}
                >
                  <div style={{ width: 148, height: 148, borderRadius: 8, overflow: "hidden", background: "var(--bg-elevated)", marginBottom: 8 }}>
                    {a.thumbnail
                      ? <img src={thumb(a.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
                  </div>
                  <div className="album-title" style={{ fontSize: "var(--t12)", fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.15s" }}>{a.title}</div>
                  {a.year && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 2 }}>{a.year}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Singles */}
        {artist.singles?.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 12 }}>{t("singles")}</div>
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
              {artist.singles.map((s, i) => (
                <div key={i} onClick={() => onOpenAlbum({ browseId: s.browseId, title: s.title, thumbnail: s.thumbnail })}
                  onContextMenu={e => onContextMenu?.(e, { browseId: s.browseId, title: s.title, thumbnail: s.thumbnail, type: "album" })}
                  style={{ flexShrink: 0, width: 148, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.querySelector(".single-title").style.color = "var(--accent)"}
                  onMouseLeave={e => e.currentTarget.querySelector(".single-title").style.color = "var(--text-primary)"}
                >
                  <div style={{ width: 148, height: 148, borderRadius: 8, overflow: "hidden", background: "var(--bg-elevated)", marginBottom: 8 }}>
                    {s.thumbnail
                      ? <img src={thumb(s.thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#2a1535,#1a0a25)" }} />}
                  </div>
                  <div className="single-title" style={{ fontSize: "var(--t12)", fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.15s" }}>{s.title}</div>
                  {s.year && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 2 }}>{s.year} · {t("single")}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Profile Manager ────────────────────────────────────────────────────────

function LoginScreen({ onSuccess, onCancel }) {
  const [step, setStep] = useState("start"); // start | waiting | success | local-create
  const [localName, setLocalName] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const t = useLang();

  useEffect(() => {
    let unlistenComplete, unlistenCancelled;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("login-complete", () => {
        setStep("success");
        setTimeout(() => onSuccess(), 1000);
      }).then(fn => { unlistenComplete = fn; });
      listen("login-cancelled", () => {
        setStep("start");
      }).then(fn => { unlistenCancelled = fn; });
    });
    return () => {
      if (unlistenComplete) unlistenComplete();
      if (unlistenCancelled) unlistenCancelled();
    };
  }, []);

  const startLogin = async () => {
    const name = "account_" + Date.now();
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_login_window", { profileName: name });
      setStep("waiting");
    } catch (e) {
      console.error("open_login_window failed:", e);
    }
  };

  const cancelLogin = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("close_login_window");
    } catch {}
    setStep("start");
  };

  const createLocalProfile = async () => {
    const name = localName.trim();
    if (!name) return;
    setLocalLoading(true);
    try {
      const res = await fetch(`${API}/auth/local-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const data = await res.json();
      if (data.ok) {
        setStep("success");
        setTimeout(() => onSuccess(), 1000);
      }
    } catch (e) {
      console.error("local-create failed:", e);
    } finally {
      setLocalLoading(false);
    }
  };

  const Logo = () => (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
      <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
        <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#login_g2)"/>
        <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
        <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
        <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
        <defs><linearGradient id="login_g2" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/></linearGradient></defs>
      </svg>
    </div>
  );

  const Btn = ({ onClick, children, secondary }) => (
    <button onClick={onClick} style={{
      width: "100%", padding: "12px", border: secondary ? "0.5px solid var(--border)" : "none",
      borderRadius: 10, color: secondary ? "var(--text-secondary)" : "#fff",
      background: secondary ? "var(--bg-elevated)" : "var(--accent)",
      fontSize: "var(--t13)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
    }}>{children}</button>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "var(--bg-base)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
    }}>
      <style>{`@keyframes spin2 { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: 420, background: "var(--bg-surface)", borderRadius: 16,
        border: "0.5px solid var(--border)", padding: "36px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)", position: "relative",
      }}>
        {onCancel && step !== "waiting" && (
          <button onClick={onCancel} style={{
            position: "absolute", top: 14, right: 14,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "50%", width: 28, height: 28, transition: "color 0.15s, background 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
          >
            <X size={16} />
          </button>
        )}
        <Logo />

        {/* ── Start ── */}
        {step === "start" && (
          <>
            <div style={{ fontSize: "var(--t20)", fontWeight: 700, textAlign: "center", marginBottom: 8 }}>{t("welcome")}</div>
            <div style={{ fontSize: "var(--t13)", color: "var(--text-muted)", textAlign: "center", marginBottom: 28, lineHeight: 1.6 }}>
              {t("loginDesc")}
            </div>
            <Btn onClick={startLogin}>
              {t("loginButton")}
            </Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: "var(--t11)", color: "var(--text-muted)" }}>{t("orSignInWithGoogle") ? t("orSignInWithGoogle").split(" ").slice(-2).join(" ") : "oder"}</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <Btn onClick={() => setStep("local-create")} secondary>
              {t("createLocalProfile")}
            </Btn>
            <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
              {t("loginHint")}
            </div>
          </>
        )}

        {/* ── Lokales Profil erstellen ── */}
        {step === "local-create" && (
          <>
            <div style={{ fontSize: "var(--t18)", fontWeight: 700, textAlign: "center", marginBottom: 6 }}>{t("localProfile")}</div>
            <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", textAlign: "center", marginBottom: 20, lineHeight: 1.6 }}>
              {t("localProfileDesc")}
            </div>
            {/* Vorteile-Panel */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px", marginBottom: 20, border: "0.5px solid var(--border)" }}>
              <div style={{ fontSize: "var(--t11)", fontWeight: 600, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 110 16A8 8 0 018 0zm.93 6.588l-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM8 5.5a1 1 0 110-2 1 1 0 010 2z"/></svg>
                {t("googleBenefits")}
              </div>
              {[
                { icon: "☁️", key: "benefitLibrary" },
                { icon: "🎵", key: "benefitRecommendations" },
                { icon: "📋", key: "benefitPlaylists" },
                { icon: "🔄", key: "benefitSync" },
              ].map(({ icon, key }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--t12)", color: "var(--text-secondary)", marginBottom: 4 }}>
                  <span>{icon}</span> {t(key)}
                </div>
              ))}
            </div>
            <input
              autoFocus
              value={localName}
              onChange={e => setLocalName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createLocalProfile()}
              placeholder={t("profileName")}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8, border: "0.5px solid var(--border)",
                background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: "var(--t13)",
                fontFamily: "var(--font)", marginBottom: 12, boxSizing: "border-box", outline: "none",
              }}
            />
            <Btn onClick={createLocalProfile} disabled={!localName.trim() || localLoading}>
              {localLoading ? "..." : t("createProfile")}
            </Btn>
            <div style={{ marginTop: 10 }}>
              <Btn onClick={() => setStep("start")} secondary>{t("cancel")}</Btn>
            </div>
          </>
        )}

        {/* ── Warten ── */}
        {step === "waiting" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid var(--bg-elevated)", borderTop: "3px solid var(--accent)", animation: "spin2 1s linear infinite", margin: "0 auto 20px" }} />
            <div style={{ fontSize: "var(--t15)", fontWeight: 600, marginBottom: 8 }}>{t("loginWaiting")}</div>
            <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
              {t("loginWaitingDesc")}
            </div>
            <Btn onClick={cancelLogin} secondary>{t("cancel")}</Btn>
          </div>
        )}

        {/* ── Erfolg ── */}
        {step === "success" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
              <CheckCircle size={52} weight="fill" style={{ color: "var(--accent)" }} />
            </div>
            <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 6 }}>{t("loginSuccess")}</div>
            <div style={{ fontSize: "var(--t13)", color: "var(--text-muted)" }}>{t("loginSuccessHint")}</div>
          </div>
        )}

      </div>
    </div>
  );
}


function LanguagePickerScreen({ currentLanguage, onConfirm }) {
  const [selected, setSelected] = useState(currentLanguage);
  const confirmLabel = translate(selected, "selectLanguage");
  const continueLabel = selected === "de" ? "Weiter" : "Continue";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "var(--bg-base)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
      animation: "fadeIn 0.3s ease",
    }}>
      <div style={{
        width: 420, background: "var(--bg-surface)", borderRadius: 16,
        border: "0.5px solid var(--border)", padding: "36px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
            <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#lp_g)"/>
            <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
            <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
            <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
            <defs><linearGradient id="lp_g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/></linearGradient></defs>
          </svg>
        </div>

        <div style={{ fontSize: "var(--t20)", fontWeight: 700, textAlign: "center", marginBottom: 6 }}>Kiyoshi Music</div>
        <div style={{ fontSize: "var(--t13)", color: "var(--text-muted)", textAlign: "center", marginBottom: 28 }}>
          {confirmLabel}
        </div>

        {/* Language cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {LANGUAGES.map(lang => (
            <div
              key={lang.code}
              onClick={() => setSelected(lang.code)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                background: selected === lang.code ? "rgba(224,64,251,0.08)" : "var(--bg-elevated)",
                border: `0.5px solid ${selected === lang.code ? "var(--accent)" : "var(--border)"}`,
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => { if (selected !== lang.code) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (selected !== lang.code) e.currentTarget.style.background = "var(--bg-elevated)"; }}
            >
              <div style={{ width: 28, height: 20, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: lang.flag }} />
              <div style={{ fontSize: "var(--t14)", fontWeight: 500, color: selected === lang.code ? "var(--accent)" : "var(--text-primary)" }}>
                {lang.label}
              </div>
              {selected === lang.code && (
                <div style={{ marginLeft: "auto" }}>
                  <Check size={14} style={{ color: "var(--accent)" }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => onConfirm(selected)}
          style={{
            width: "100%", padding: "12px", border: "none",
            borderRadius: 10, color: "#fff", background: "var(--accent)",
            fontSize: "var(--t13)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
          }}
        >
          {continueLabel} →
        </button>
      </div>
    </div>
  );
}

function ProfileSwitcher({ profiles, currentProfile, onSwitch, onAdd, onDelete, onClose, triggerRef }) {
  const t = useLang();
  const [confirmName, setConfirmName] = useState(null);
  const ref = useRef(null);

  const confirmProfile = confirmName ? profiles.find(p => p.name === confirmName) : null;

  // Close on outside click — but exclude the trigger element so its onClick can toggle correctly
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !triggerRef?.current?.contains(e.target))
        onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, triggerRef]);

  return (
    <div ref={ref} style={{
      position: "absolute", bottom: "calc(100% + 8px)", left: 8, right: 8,
      background: "var(--bg-surface)", borderRadius: 12,
      border: "0.5px solid var(--border)",
      boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
      zIndex: 1500, overflow: "hidden",
      animation: "fadeIn 0.15s ease",
    }}>
      {/* Confirmation Dialog */}
      {confirmName ? (
        <div style={{ padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", background: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "var(--t14)", fontWeight: 700, color: "#fff", overflow: "hidden", flexShrink: 0,
            }}>
              {confirmProfile?.avatar
                ? <img src={thumb(confirmProfile.avatar)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (confirmProfile?.displayName || confirmProfile?.name || "?")[0].toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: "var(--t13)", fontWeight: 600 }}>{confirmProfile?.displayName || confirmProfile?.name}</div>
              {confirmProfile?.handle && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)" }}>{confirmProfile.handle}</div>}
            </div>
          </div>
          <div style={{ fontSize: "var(--t13)", fontWeight: 600, marginBottom: 4 }}>{t("removeAccountTitle")}</div>
          <div style={{ fontSize: "var(--t12)", color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>{t("removeAccountDesc")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmName(null)} style={{
              flex: 1, padding: "8px", background: "var(--bg-elevated)",
              border: "0.5px solid var(--border)", borderRadius: 8,
              color: "var(--text-secondary)", fontSize: "var(--t12)", cursor: "pointer", fontFamily: "var(--font)",
            }}>{t("cancel")}</button>
            <button onClick={() => { onDelete(confirmName); setConfirmName(null); }} style={{
              flex: 1, padding: "8px", background: "rgba(244,67,54,0.12)",
              border: "0.5px solid #f44336", borderRadius: 8,
              color: "#f44336", fontSize: "var(--t12)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
            }}>{t("removeAccountConfirm")}</button>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ padding: "12px 14px 8px", borderBottom: "0.5px solid var(--border)" }}>
            <div style={{ fontSize: "var(--t11)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("switchProfileTitle")}</div>
          </div>

          {/* Profile list */}
          <div style={{ padding: "6px 6px 0" }}>
            {profiles.map(p => (
              <div key={p.name} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 8, marginBottom: 2,
                background: p.active ? "rgba(224,64,251,0.08)" : "transparent",
                cursor: p.active ? "default" : "pointer",
                transition: "background 0.15s",
              }}
              onClick={() => { if (!p.active) onSwitch(p.name); }}
              onMouseEnter={e => { if (!p.active) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (!p.active) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: p.type === "local" ? "var(--bg-elevated)" : "var(--accent)",
                  border: p.type === "local" ? "0.5px solid var(--border)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "var(--t12)", fontWeight: 700, flexShrink: 0, color: p.type === "local" ? "var(--text-secondary)" : "#fff", overflow: "hidden",
                }}>
                  {p.type === "local"
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                    : p.avatar
                      ? <img src={thumb(p.avatar)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : (p.displayName || p.name)[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: "var(--t12)", fontWeight: 500, color: p.active ? "var(--accent)" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.displayName || p.name}</div>
                  {p.type === "local"
                    ? <div style={{ fontSize: "var(--t10)", color: "var(--text-muted)" }}>{t("localAccount")}</div>
                    : p.handle && <div style={{ fontSize: "var(--t10)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.handle}</div>}
                </div>
                {p.type === "local" && p.active && (
                  <div title={t("linkGoogleAccount")} onClick={e => { e.stopPropagation(); onAdd && onAdd(); }} style={{
                    padding: 3, borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, transition: "color 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                  onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                  >
                    <Link size={13} />
                  </div>
                )}
                <div onClick={e => { e.stopPropagation(); setConfirmName(p.name); }} style={{
                  padding: 3, borderRadius: 4, cursor: "pointer", color: "var(--text-muted)",
                  transition: "color 0.15s", flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#f44336"}
                onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                >
                  <Trash size={13} />
                </div>
              </div>
            ))}
          </div>

          {/* Add account */}
          <div style={{ padding: "6px" }}>
            <button onClick={onAdd} style={{
              width: "100%", padding: "8px 10px", background: "transparent",
              border: "none", borderRadius: 8,
              color: "var(--text-secondary)", fontSize: "var(--t12)", cursor: "pointer",
              fontFamily: "var(--font)", display: "flex", alignItems: "center", gap: 8,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <div style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              {t("addAccount")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── FFmpeg Setup Screen ──────────────────────────────────────────────────────
function FfmpegSetupScreen({ onDone }) {
  const [phase, setPhase]       = useState("checking"); // checking | needed | downloading | done | error
  const [percent, setPercent]   = useState(0);
  const [mbDone, setMbDone]     = useState(0);
  const [mbTotal, setMbTotal]   = useState(0);
  const [speedKbps, setSpeedKbps] = useState(0);
  const [errMsg, setErrMsg]     = useState("");
  const [fadeOut, setFadeOut]   = useState(false);

  useEffect(() => {
    // Offline → no FFmpeg download possible anyway, skip immediately.
    if (!navigator.onLine) {
      setPhase("done");
      onDone();
      return;
    }

    const check = async (retries = 8) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1500); // 1.5s per attempt
        const r = await fetch(`${API}/ffmpeg/status`, { signal: ctrl.signal });
        clearTimeout(tid);
        const d = await r.json();
        if (d.available) {
          // Cache result so we skip this screen on future starts.
          localStorage.setItem("kiyoshi-ffmpeg-ok", "1");
          setFadeOut(true);
          setTimeout(() => { setPhase("done"); onDone(); }, 400);
        } else {
          setPhase("needed");
        }
      } catch {
        if (retries > 0) {
          setTimeout(() => check(retries - 1), 400);
        } else {
          // Backend not reachable after all retries → proceed anyway.
          setPhase("done");
          onDone();
        }
      }
    };
    check();
  }, [onDone]);

  const startDownload = () => {
    setPhase("downloading");
    setPercent(0);

    const es = new EventSource(`${API}/ffmpeg/download`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.status === "progress") {
          setPercent(data.percent || 0);
          setMbDone(data.mb_done || 0);
          setMbTotal(data.mb_total || 0);
          setSpeedKbps(data.speed_kbps || 0);
        } else if (data.status === "done") {
          es.close();
          setPercent(100);
          setPhase("done");
          localStorage.setItem("kiyoshi-ffmpeg-ok", "1");
          // Neustart nach kurzer Pause
          setTimeout(() => {
            import("@tauri-apps/api/core")
              .then(({ invoke }) => invoke("relaunch_app"))
              .catch(() => { onDone(); }); // im Dev-Modus kein relaunch → einfach weiter
          }, 1200);
        } else if (data.status === "error") {
          es.close();
          setErrMsg(data.message || "Unbekannter Fehler");
          setPhase("error");
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setErrMsg("Verbindung zum Backend unterbrochen.");
      setPhase("error");
    };
  };

  if (phase === "done") return null;

  const fmtSpeed = (kbps) => kbps > 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: phase === "checking" ? 9997 : 9998,
      background: "#0d0d0d",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      opacity: fadeOut ? 0 : 1, transition: "opacity 0.4s ease",
      fontFamily: "var(--font)",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", width: 320, height: 320, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(238,168,255,0.12) 0%, rgba(255,0,140,0.06) 55%, transparent 72%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: 360 }}>
        {/* Logo */}
        <svg width="56" height="56" viewBox="0 0 32 32" fill="none" style={{ filter: "drop-shadow(0 0 20px rgba(238,168,255,0.4))" }}>
          <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#ffmpegSetup_g)"/>
          <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
          <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
          <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
          <defs>
            <linearGradient id="ffmpegSetup_g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/>
            </linearGradient>
          </defs>
        </svg>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
            {phase === "checking"    && "Kiyoshi Music"}
            {phase === "needed"      && "Einmaliger Setup"}
            {phase === "downloading" && "FFmpeg wird installiert…"}
            {phase === "error"       && "Download fehlgeschlagen"}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, maxWidth: 300 }}>
            {phase === "checking" && "Wird geladen…"}
            {phase === "needed" && "FFmpeg wurde nicht gefunden und wird einmalig heruntergeladen (~130 MB). Es wird für den MP3-Export benötigt."}
            {phase === "downloading" && mbTotal > 0 && `${mbDone} / ${mbTotal} MB · ${fmtSpeed(speedKbps)}`}
            {phase === "error" && errMsg}
          </div>
        </div>

        {/* Progress bar */}
        {phase === "downloading" && (
          <div style={{ width: "100%", height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: "linear-gradient(90deg, #EEA8FF, #FF008C)",
              width: `${percent}%`, transition: "width 0.3s ease",
            }} />
          </div>
        )}

        {/* Buttons */}
        {phase === "needed" && (
          <div style={{ display: "flex", gap: 12, width: "100%" }}>
            <button
              onClick={() => { setFadeOut(true); setTimeout(() => { setPhase("done"); onDone(); }, 400); }}
              style={{
                flex: 1, padding: "10px", borderRadius: 8,
                background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.5)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font)",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
            >Überspringen</button>
            <button
              onClick={startDownload}
              style={{
                flex: 2, padding: "10px", borderRadius: 8,
                background: "linear-gradient(135deg, #EEA8FF, #FF008C)",
                border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font)", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >FFmpeg herunterladen</button>
          </div>
        )}

        {phase === "error" && (
          <button
            onClick={() => { setFadeOut(true); setTimeout(() => { setPhase("done"); onDone(); }, 400); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 8,
              background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.6)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font)",
            }}
          >Trotzdem starten</button>
        )}
      </div>
    </div>
  );
}

function SplashScreen({ fading }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0d0d0d",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      animation: fading ? "splashFadeOut 0.45s ease forwards" : "none",
      pointerEvents: "none",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        width: 300, height: 300,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(238,168,255,0.15) 0%, rgba(255,0,140,0.08) 55%, transparent 72%)",
        animation: "splashGlow 2.4s ease-in-out infinite",
      }} />

      {/* Logo */}
      <div style={{
        animation: "splashLogoIn 0.75s cubic-bezier(0.34,1.56,0.64,1) forwards",
        opacity: 0,
        position: "relative", zIndex: 1,
        filter: "drop-shadow(0 0 28px rgba(238,168,255,0.45)) drop-shadow(0 0 8px rgba(255,0,140,0.3))",
      }}>
        <svg width="88" height="88" viewBox="0 0 32 32" fill="none">
          <path d="M0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16C32 24.8366 24.8366 32 16 32H6.4C2.86538 32 0 29.1346 0 25.6V16Z" fill="url(#splash_g)"/>
          <path d="M16 5C22.0751 5 27 9.92487 27 16C27 22.0751 22.0751 27 16 27H8.7998C6.70128 26.9999 5.00011 25.2987 5 23.2002V16C5 9.92487 9.92487 5 16 5Z" stroke="white" strokeWidth="2" style={{mixBlendMode:"overlay"}}/>
          <path d="M16.5547 11.5C16.6656 11.5 16.7695 11.5552 16.8311 11.6475L18.2139 13.7227C18.3258 13.8906 18.3258 14.1094 18.2139 14.2773L16.8311 16.3525C16.7695 16.4448 16.6656 16.5 16.5547 16.5C16.2895 16.5 16.1312 16.2041 16.2783 15.9834L17.252 14.5234C17.4631 14.2067 17.4631 13.7933 17.252 13.4766L16.2783 12.0166C16.1312 11.7959 16.2895 11.5 16.5547 11.5Z" stroke="white" style={{mixBlendMode:"overlay"}}/>
          <rect x="20.5" y="11.5" width="1" height="5" rx="0.5" stroke="white" style={{mixBlendMode:"overlay"}}/>
          <defs>
            <linearGradient id="splash_g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#EEA8FF"/><stop offset="1" stopColor="#FF008C"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  // Skip FFmpeg screen if we already confirmed it available in a previous run.
  const [ffmpegSetupDone, setFfmpegSetupDone] = useState(
    () => localStorage.getItem("kiyoshi-ffmpeg-ok") === "1"
  );

  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFading(true), 1700);
    const hideTimer = setTimeout(() => setShowSplash(false), 2150);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  const [view, setView] = useState("home");
  const [appKey, setAppKey] = useState(0); // increment to force full re-render
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalContextMenu, setGlobalContextMenu] = useState(null); // { x, y, playlist }
  const [globalCtxData, setGlobalCtxData] = useState(null);
  const [globalCtxClosing, setGlobalCtxClosing] = useState(false);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [trackContextMenu, setTrackContextMenu] = useState(null); // { x, y, track, playlistId? }
  const [trackCtxData, setTrackCtxData] = useState(null);
  const [trackCtxClosing, setTrackCtxClosing] = useState(false);
  const [trackCtxPlaylists, setTrackCtxPlaylists] = useState(null); // loaded playlists for submenu
  const [renameDialog, setRenameDialog] = useState(null); // { playlistId, title }
  const [deleteDialog, setDeleteDialog] = useState(null); // { playlistId, title }
  const [cachedSongIds, setCachedSongIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [premiumSongIds, setPremiumSongIds] = useState(new Set());
  const [offlineMode, setOfflineMode] = useState(() => localStorage.getItem("kiyoshi-offline") === "true");
  const [isActuallyOffline, setIsActuallyOffline] = useState(() => !navigator.onLine);
  const [debugFloat, setDebugFloat] = useState(false);
  const [downloadQueue, setDownloadQueue] = useState([]); // [{videoId, title, artists, thumbnail, status, progress}]
  const [downloadBatches, setDownloadBatches] = useState([]); // [{id, title, thumbnail, artists, videoIds[], completedCount, errorCount}]
  const [pendingDownloadQueue, setPendingDownloadQueue] = useState([]); // tracks waiting for a free slot
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const updateDownloadAbortRef = useRef(null);
  const mutePrevVolumeRef = useRef(0.5);
  const [toasts, setToasts] = useState([]);

  // ─── Toast Notifications ─────────────────────────────────────────────────────
  const addToast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === "error" ? 6000 : 3500);
  }, []);

  // ─── Update Check ───────────────────────────────────────────────────────────
  const checkForUpdates = useCallback(() => {
    return fetch(GITHUB_RELEASES_API)
      .then(r => r.json())
      .then(([release] = []) => {
        if (release?.tag_name && isNewerVersion(release.tag_name, APP_TAG)) {
          const asset = release.assets?.find(a => a.name.endsWith(".exe"));
          setUpdateInfo({
            version: release.name || release.tag_name,
            tag: release.tag_name,
            downloadUrl: asset?.browser_download_url || release.html_url,
            assetName: asset?.name || "",
            assetSize: asset?.size || 0,
            changelog: release.body || "",
            releasedAt: release.published_at,
          });
        } else {
          setUpdateInfo(null);
        }
      })
      .catch(() => {});
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl) return;
    const controller = new AbortController();
    updateDownloadAbortRef.current = controller;
    setUpdateDownloading(true);
    setUpdateDownloadProgress(0);
    setUpdateDownloaded(false);
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const response = await tauriFetch(updateInfo.downloadUrl, { method: "GET" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      setUpdateDownloadProgress(90);
      const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      await writeFile(updateInfo.assetName || "KiyoshiMusicUpdate.exe", bytes, { baseDir: BaseDirectory.Download });
      setUpdateDownloaded(true);
      setUpdateDownloadProgress(100);
    } catch (e) {
      if (e?.name !== "AbortError") {
        const lang = getInitialLang();
        addToast(translate(lang, "downloadFailed"), "error");
        setUpdateDownloadProgress(null);
      }
    } finally {
      setUpdateDownloading(false);
    }
  }, [updateInfo, addToast]);

  const installUpdate = useCallback(async () => {
    if (!updateInfo?.assetName) return;
    try {
      const { downloadDir } = await import("@tauri-apps/api/path");
      const dir = await downloadDir();
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(dir + "\\" + updateInfo.assetName);
    } catch {
      const lang = getInitialLang();
      addToast(translate(lang, "downloadFailed"), "error");
    }
  }, [updateInfo, addToast]);

  const cancelUpdateDownload = useCallback(() => {
    updateDownloadAbortRef.current?.abort();
    setUpdateDownloading(false);
    setUpdateDownloadProgress(null);
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, []);

  // Unified item ID — playlists use playlistId, albums use browseId
  const itemId = (item) => item?.playlistId || item?.browseId || null;
  const profileKey = (base) => `${base}-${window.__activeProfile || "default"}`;

  const togglePin = useCallback((pl) => {
    const stored = (() => { try { return JSON.parse(localStorage.getItem(profileKey("kiyoshi-pinned")) || "[]"); } catch { return []; } })();
    const id = itemId(pl);
    const already = stored.find(p => itemId(p) === id);
    const next = already ? stored.filter(p => itemId(p) !== id) : [pl, ...stored];
    localStorage.setItem(profileKey("kiyoshi-pinned"), JSON.stringify(next));
    setPinnedIds(next.map(p => itemId(p)));
    window.dispatchEvent(new Event("kiyoshi-pins-updated"));
  }, []);

  const openContextMenu = useCallback((e, pl) => {
    e.preventDefault();
    setGlobalContextMenu({ x: e.clientX, y: e.clientY, playlist: pl });
  }, []);

  // Animate track context menu open/close
  useEffect(() => {
    if (trackContextMenu) {
      setTrackCtxData(trackContextMenu);
      setTrackCtxClosing(false);
    } else if (trackCtxData) {
      setTrackCtxClosing(true);
      const t = setTimeout(() => { setTrackCtxData(null); setTrackCtxClosing(false); }, 140);
      return () => clearTimeout(t);
    }
  }, [trackContextMenu]);

  // Animate global context menu open/close
  useEffect(() => {
    if (globalContextMenu) {
      setGlobalCtxData(globalContextMenu);
      setGlobalCtxClosing(false);
    } else if (globalCtxData) {
      setGlobalCtxClosing(true);
      const t = setTimeout(() => { setGlobalCtxData(null); setGlobalCtxClosing(false); }, 140);
      return () => clearTimeout(t);
    }
  }, [globalContextMenu]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);
  const [accent, setAccent] = useState(() => {
    const saved = localStorage.getItem("kiyoshi-accent");
    if (saved) document.documentElement.style.setProperty("--accent", saved);
    return saved || "#e040fb";
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("kiyoshi-theme") || "dark");
  const [highContrast, setHighContrast] = useState(() => {
    const hc = localStorage.getItem("kiyoshi-high-contrast") === "true";
    if (hc) document.documentElement.setAttribute("data-highcontrast", "true");
    return hc;
  });
  const [appFont, setAppFont] = useState(() => {
    const saved = localStorage.getItem("kiyoshi-app-font") || "default";
    if (saved === "dyslexic") document.documentElement.style.setProperty("--font", "'OpenDyslexic', system-ui, sans-serif");
    return saved;
  });
  const handleAppFontChange = useCallback((id) => {
    setAppFont(id);
    localStorage.setItem("kiyoshi-app-font", id);
    if (id === "dyslexic") {
      document.documentElement.style.setProperty("--font", "'OpenDyslexic', system-ui, sans-serif");
    } else {
      document.documentElement.style.setProperty("--font", "'MiSans Latin', system-ui, sans-serif");
    }
  }, []);
  const [ambientVisualizer, setAmbientVisualizer] = useState(() =>
    localStorage.getItem("kiyoshi-ambient-visualizer") !== "false"
  );
  const [flashbang, setFlashbang] = useState(false);
  const lightClickRef = useRef({ count: 0, lastTime: 0 });

  const handleAccentChange = useCallback((color) => {
    setAccent(color);
    document.documentElement.style.setProperty("--accent", color);
    localStorage.setItem("kiyoshi-accent", color);
  }, []);

  const handleThemeChange = useCallback((t) => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("kiyoshi-theme", t);
    if (t === "light") {
      const now = Date.now();
      if (now - lightClickRef.current.lastTime < 700) {
        lightClickRef.current.count++;
        if (lightClickRef.current.count >= 4) {
          lightClickRef.current.count = 0;
          setFlashbang(true);
        }
      } else {
        lightClickRef.current.count = 1;
      }
      lightClickRef.current.lastTime = now;
    } else {
      lightClickRef.current.count = 0;
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [discordRpc, setDiscordRpc] = useState(() => localStorage.getItem("kiyoshi-discord-rpc") !== "false");
  const [queue, setQueue] = useState([]);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [lyricsRefetchKey, setLyricsRefetchKey] = useState(0);
  const [forcedLyricsProvider, setForcedLyricsProvider] = useState(null);
  const [currentLyricsSource, setCurrentLyricsSource] = useState("");
  const [failedLyricsProviders, setFailedLyricsProviders] = useState(new Set());
  const [showLyricsTranslation, setShowLyricsTranslation] = useState(() =>
    localStorage.getItem("kiyoshi-lyrics-translation") === "true"
  );
  const [lyricsTranslationLang, setLyricsTranslationLang] = useState(() =>
    localStorage.getItem("kiyoshi-lyrics-translation-lang") || "DE"
  );
  const [showRomaji, setShowRomaji] = useState(() =>
    localStorage.getItem("kiyoshi-lyrics-romaji") === "true"
  );
  const [isCustomLyrics, setIsCustomLyrics] = useState(false);
  const [showAgentTags, setShowAgentTags] = useState(() => localStorage.getItem("kiyoshi-lyrics-agent-tags") !== "false");
  const importLyricsRef = useRef(null);
  const removeCustomLyricsRef = useRef(null);

  // Reset lyrics state on every track change (incl. auto-advance / prev-next)
  useEffect(() => {
    setFailedLyricsProviders(new Set());
    setForcedLyricsProvider(null);
    setCurrentLyricsSource("");
  }, [currentTrack?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showLyrics, setShowLyrics] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(true);
  const [cursorVisible, setCursorVisible] = useState(true);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    if (!fullscreen) {
      setPlayerVisible(true);
      setCursorVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      return;
    }
    const onMove = (e) => {
      setPlayerVisible(true);
      setCursorVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setPlayerVisible(false);
        setCursorVisible(false);
      }, 3000);
    };
    // Start timer immediately when entering fullscreen
    hideTimerRef.current = setTimeout(() => {
      setPlayerVisible(false);
      setCursorVisible(false);
    }, 3000);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [fullscreen]);

  const [collection, setCollection] = useState(null); // { title, thumbnail, tracks }
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new IpcAudio();

  // Update native window title (= taskbar) whenever the playing track or state changes.
  // When paused for >30 s, revert to "Kiyoshi Music".
  useEffect(() => {
    const setWinTitle = (t) => {
      document.title = t;
      import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().setTitle(t))
        .catch(() => {});
    };

    if (!currentTrack) {
      setWinTitle("Kiyoshi Music");
      return;
    }

    const trackTitle = `${currentTrack.title} – ${currentTrack.artists}`;

    if (isPlaying) {
      setWinTitle(trackTitle);
    } else {
      // Paused: keep the track title but reset after 30 s of inactivity
      const timer = setTimeout(() => setWinTitle("Kiyoshi Music"), 30_000);
      return () => clearTimeout(timer);
    }
  }, [currentTrack, isPlaying]);

  // Discord Rich Presence — show current track in Discord profile.
  // Debounced (800ms) to avoid flickering on rapid track changes.
  // Periodic refresh every 15s keeps elapsed time accurate after seeks.
  const discordUpdateRef = useRef(null);
  useEffect(() => {
    let cancelled = false;

    const send = async () => {
      if (cancelled) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!discordRpc || !currentTrack) {
          invoke("clear_discord_rpc").catch(() => {});
          return;
        }
        const a = audioRef.current;
        const dur = a?.duration;
        // Skip update if audio metadata hasn't loaded yet
        if (!dur || isNaN(dur)) return;
        invoke("update_discord_rpc", {
          title: currentTrack.title || "",
          artist: currentTrack.artists || "",
          album: currentTrack.album || "",
          thumbnail: currentTrack.thumbnail || "",
          duration: dur,
          elapsed: a?.currentTime || 0,
          videoId: currentTrack.videoId || "",
          paused: !isPlaying,
        }).catch(() => {});
      } catch {}
    };

    // Debounce: wait 800ms before sending to let rapid state changes settle
    const debounce = setTimeout(send, 800);
    // Periodic refresh for elapsed time accuracy
    const interval = setInterval(send, 15000);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [currentTrack, isPlaying, discordRpc]);

  // Kimuco Bridge — report now-playing to the OBS overlay app.
  useEffect(() => {
    const report = () => {
      const a = audioRef.current;
      const coverUrl = currentTrack?.thumbnail
        ? `${API}/imgproxy?url=${encodeURIComponent(currentTrack.thumbnail)}`
        : "";
      fetch("http://127.0.0.1:8888/api/source/kiyoshi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(500),
        body: JSON.stringify({
          title:     currentTrack?.title    || "",
          artist:    currentTrack?.artists  || "",
          album:     currentTrack?.album    || "",
          cover:     coverUrl,
          progress:  a?.currentTime        || 0,
          duration:  a?.duration           || 0,
          isPlaying: isPlaying && !!currentTrack,
        }),
      }).catch(() => {});
    };

    report();
    const id = setInterval(report, 1000);
    return () => clearInterval(id);
  }, [currentTrack, isPlaying]);

  const handlePlay = useCallback((track, trackList) => {
    setCurrentTrack(track);
    setForcedLyricsProvider(null);
    setCurrentLyricsSource("");
    setFailedLyricsProviders(new Set());
    if (trackList) {
      const seen = new Set();
      const deduped = trackList.filter(t => {
        if (!t.videoId || seen.has(t.videoId)) return false;
        seen.add(t.videoId);
        return true;
      });
      setQueue(deduped);
    }
    // Save to play history
    if (track?.videoId) {
      try {
        const key = `kiyoshi-history-${window.__activeProfile || "default"}`;
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        const entry = { ...track, playedAt: Date.now() };
        // Don't add duplicate of the very last played track
        const filtered = stored.filter((t, i) => !(i === 0 && t.videoId === track.videoId));
        localStorage.setItem(key, JSON.stringify([entry, ...filtered].slice(0, 200)));
        window.dispatchEvent(new Event("kiyoshi-history-updated"));
      } catch {}
    }
  }, []);

  // Global queue poll — runs whenever there are active downloads
  useEffect(() => {
    if (downloadingIds.size === 0) return;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${API}/downloads/queue`);
        const d = await r.json();
        const queue = d.queue || [];
        setDownloadQueue(queue);
        const doneIds = queue.filter(i => i.status === "done").map(i => i.videoId);
        const errorIds = queue.filter(i => i.status === "error").map(i => i.videoId);
        const premiumIds = queue.filter(i => i.status === "error" && i.error_type === "premium_only").map(i => i.videoId);
        const finishedIds = [...doneIds, ...errorIds];
        if (doneIds.length) setCachedSongIds(prev => { const s = new Set(prev); doneIds.forEach(id => s.add(id)); return s; });
        if (premiumIds.length) setPremiumSongIds(prev => { const s = new Set(prev); premiumIds.forEach(id => s.add(id)); return s; });
        if (finishedIds.length) {
          setDownloadingIds(prev => { const s = new Set(prev); finishedIds.forEach(id => s.delete(id)); return s; });
          setDownloadBatches(prev => prev.map(b => {
            const added = doneIds.filter(id => b.videoIds.includes(id)).length;
            const addedErr = errorIds.filter(id => b.videoIds.includes(id)).length;
            return (added || addedErr) ? { ...b, completedCount: b.completedCount + added, errorCount: b.errorCount + addedErr } : b;
          }));
        }
      } catch {}
    }, 1500);
    return () => clearInterval(poll);
  }, [downloadingIds.size]);

  // Remove fully-finished batches after a short delay
  useEffect(() => {
    const done = downloadBatches.filter(b => b.completedCount + b.errorCount >= b.videoIds.length);
    if (!done.length) return;
    const t = setTimeout(() => {
      setDownloadBatches(prev => prev.filter(b => b.completedCount + b.errorCount < b.videoIds.length));
    }, 2500);
    return () => clearTimeout(t);
  }, [downloadBatches]);

  // Drain pending queue — start next tracks whenever a slot opens up (max 5 concurrent)
  const MAX_CONCURRENT_DOWNLOADS = 5;
  useEffect(() => {
    if (pendingDownloadQueue.length === 0) return;
    const slots = MAX_CONCURRENT_DOWNLOADS - downloadingIds.size;
    if (slots <= 0) return;
    const toStart = pendingDownloadQueue.slice(0, slots);
    setPendingDownloadQueue(prev => prev.slice(toStart.length));
    toStart.forEach(track => handleDownloadSong(track));
  }, [pendingDownloadQueue.length, downloadingIds.size]);

  const handleDownloadSong = useCallback(async (track) => {
    if (!track?.videoId || downloadingIds.has(track.videoId) || cachedSongIds.has(track.videoId)) return;
    setDownloadingIds(prev => new Set(prev).add(track.videoId));
    try {
      await fetch(`${API}/song/download/${track.videoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: track.title, artists: track.artists, album: track.album, duration: track.duration, thumbnail: track.thumbnail }),
      });
    } catch {
      setDownloadingIds(prev => { const s = new Set(prev); s.delete(track.videoId); return s; });
    }
  }, [downloadingIds, cachedSongIds]);

  const handleDownloadAll = useCallback((tracks, meta = {}) => {
    const eligible = tracks.filter(t => !cachedSongIds.has(t.videoId) && !downloadingIds.has(t.videoId));
    if (!eligible.length) return;
    const batchId = Date.now().toString();
    setDownloadBatches(prev => [...prev, {
      id: batchId,
      title: meta.title || "",
      thumbnail: meta.thumbnail || "",
      artists: meta.artists || "",
      videoIds: eligible.map(t => t.videoId),
      completedCount: 0,
      errorCount: 0,
    }]);
    setPendingDownloadQueue(prev => [...prev, ...eligible]);
  }, [cachedSongIds, downloadingIds]);

  const handleRemoveAllDownloads = useCallback(async (tracks) => {
    const videoIds = tracks.filter(t => cachedSongIds.has(t.videoId)).map(t => t.videoId);
    if (!videoIds.length) return;
    try {
      await fetch(`${API}/songs/cached/delete-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds }),
      });
      setCachedSongIds(prev => {
        const s = new Set(prev);
        videoIds.forEach(id => s.delete(id));
        return s;
      });
    } catch {}
  }, [cachedSongIds]);

  const [language, setLanguage] = useState(() => getInitialLang());

  const handleExportSong = useCallback(async (track, format) => {
    if (!track?.videoId) return;
    try {
      if (format === "mp3") {
        const ffRes = await fetch(`${API}/song/export/ffmpeg-available`).then(r => r.json()).catch(() => ({ available: false }));
        if (!ffRes.available) { addToast(translate(language, "noFfmpeg"), "error"); return; }
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const artistStr = Array.isArray(track.artists)
        ? track.artists.map(a => typeof a === "string" ? a : a.name).join(", ")
        : (track.artists || "Unknown");
      const ext = format === "mp3" ? "mp3" : "opus";
      const defaultName = `${artistStr} - ${track.title || "Song"}.${ext}`;
      const defaultDir = localStorage.getItem("kiyoshi-mp3-dir") || undefined;
      const filePath = await save({
        title: translate(language, format === "mp3" ? "saveAsMp3" : "saveAsOpus"),
        defaultPath: defaultDir ? `${defaultDir}\\${defaultName}` : defaultName,
        filters: format === "mp3"
          ? [{ name: "MP3", extensions: ["mp3"] }]
          : [{ name: "OPUS", extensions: ["opus", "webm"] }],
      });
      if (!filePath) return;
      const dir = filePath.replace(/[\\/][^\\/]+$/, "");
      if (dir) localStorage.setItem("kiyoshi-mp3-dir", dir);
      const artistStr2 = Array.isArray(track.artists) ? track.artists.map(a => typeof a === "string" ? a : a.name).join(", ") : (track.artists || "");
      await fetch(`${API}/song/export/${track.videoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_path: filePath, format, title: track.title || "", artists: artistStr2, album: track.album || "", year: track.year || "", albumBrowseId: track.albumBrowseId || "", thumbnail: track.thumbnail || "" }),
      });
      addToast(translate(language, "exportStarted"), "info");
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`${API}/song/export/status/${track.videoId}`);
          const d = await r.json();
          if (d.status === "done") { clearInterval(poll); addToast(translate(language, "exportDone"), "success"); }
          else if (d.status === "error") { clearInterval(poll); addToast(translate(language, "exportError"), "error"); }
        } catch { clearInterval(poll); }
      }, 2000);
    } catch {}
  }, [language, addToast]);

  const handleSearch = useCallback(q => {
    setSearchQuery(q);
    setView("search");
  }, []);

  const addRecentPlaylist = useCallback((pl) => {
    const key = profileKey("kiyoshi-recent");
    const stored = (() => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } })();
    const id = itemId(pl);
    const next = [pl, ...stored.filter(p => itemId(p) !== id)].slice(0, 5);
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event("kiyoshi-recent-updated"));
  }, []);

  const removeRecentPlaylist = useCallback((id) => {
    const key = profileKey("kiyoshi-recent");
    const stored = (() => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } })();
    const next = stored.filter(p => (p.playlistId || p.browseId) !== id);
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event("kiyoshi-recent-updated"));
  }, []);

  const openPlaylist = useCallback((item, fromView, refresh = false) => {
    // forcedTitle: when the caller provides a custom title (e.g. "Dusqk – Top Songs"),
    // we keep it and don't let the stream header overwrite it.
    const forcedTitle = item.forcedTitle || null;
    setCollection({ title: forcedTitle || item.title, thumbnail: item.thumbnail, tracks: [], total: null, loading: true, progress: 0, cached: false, fromView: fromView || "library", forcedTitle, playlistId: item.playlistId });
    setView("collection");
    addRecentPlaylist({ playlistId: item.playlistId, title: forcedTitle || item.title, thumbnail: item.thumbnail, ...(forcedTitle ? { forcedTitle } : {}) });

    // Animate progress bar while waiting (fake progress up to 85%)
    let fakeProgress = 0;
    const interval = setInterval(() => {
      fakeProgress = Math.min(85, fakeProgress + Math.random() * 4);
      setCollection(c => c.loading ? { ...c, progress: Math.round(fakeProgress) } : c);
    }, 400);

    const url = `${API}/playlist/${item.playlistId}/stream${refresh ? "?refresh=1" : ""}`;
    const es = new EventSource(url);
    es.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === "header") {
        setCollection(c => ({ ...c, title: c.forcedTitle || msg.title, thumbnail: msg.thumbnail || c.thumbnail, total: msg.total, cached: msg.cached || false }));
      } else if (msg.type === "tracks") {
        setCollection(c => ({ ...c, tracks: [...c.tracks, ...msg.tracks] }));
      } else if (msg.type === "done" || msg.type === "error") {
        clearInterval(interval);
        setCollection(c => ({ ...c, progress: 100 }));
        setTimeout(() => setCollection(c => ({ ...c, loading: false })), 400);
        es.close();
      }
    };
    es.onerror = () => { clearInterval(interval); setCollection(c => ({ ...c, loading: false })); es.close(); };
  }, []);

  const openAlbum = useCallback(async (item, fromView, refresh = false) => {
    setCollection({ title: item.title, thumbnail: item.thumbnail, tracks: [], total: null, loading: false, progress: 0, cached: false, fromView: fromView || "library", isAlbum: true, browseId: item.browseId });
    setView("collection");
    addRecentPlaylist({ browseId: item.browseId, title: item.title, thumbnail: item.thumbnail, type: "album" });
    const url = `${API}/album/${item.browseId}${refresh ? "?refresh=1" : ""}`;
    const r = await fetch(url);
    const d = await r.json();
    setCollection(c => ({ ...c, title: d.title, thumbnail: d.thumbnail || c.thumbnail, tracks: d.tracks || [], total: d.tracks?.length || 0, albumArtists: d.artists, albumArtistBrowseId: d.artistBrowseId, year: d.year, cached: !refresh && !!d.cached }));
  }, [addRecentPlaylist]);

  const [animations, setAnimations] = useState(() => localStorage.getItem("kiyoshi-animations") !== "false");
  const [lyricsFontSize, setLyricsFontSize] = useState(() => {
    const s = parseInt(localStorage.getItem("kiyoshi-lyrics-font-size"));
    return isNaN(s) ? 32 : s;
  });
  const [lyricsTranslationFontSize, setLyricsTranslationFontSize] = useState(() => {
    const s = parseInt(localStorage.getItem("kiyoshi-lyrics-translation-font-size"));
    return isNaN(s) ? 20 : s;
  });
  const [lyricsRomajiFontSize, setLyricsRomajiFontSize] = useState(() => {
    const s = parseInt(localStorage.getItem("kiyoshi-lyrics-romaji-font-size"));
    return isNaN(s) ? 18 : s;
  });
  const [hideExplicit, setHideExplicit] = useState(() => localStorage.getItem("kiyoshi-hide-explicit") === "true");
  const [uiZoom, setUiZoom] = useState(() => {
    const saved = parseFloat(localStorage.getItem("kiyoshi-ui-zoom"));
    return ZOOM_STEPS.includes(saved) ? saved : 1.0;
  });
  const CSS_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22];
  const [appFontScale, setAppFontScale] = useState(() => {
    const saved = parseFloat(localStorage.getItem("kiyoshi-font-scale"));
    const scale = FONT_STEPS.includes(saved) ? saved : 1.0;
    // Set CSS vars synchronously to avoid flash of unstyled text
    CSS_FONT_SIZES.forEach(s => {
      document.documentElement.style.setProperty(`--t${s}`, `${Math.round(s * scale)}px`);
    });
    return scale;
  });

  useEffect(() => {
    CSS_FONT_SIZES.forEach(s => {
      document.documentElement.style.setProperty(`--t${s}`, `${Math.round(s * appFontScale)}px`);
    });
  }, [appFontScale]);

  // uiZoom wird direkt im App-Container angewendet (kein document.documentElement),
  // damit position:fixed / 100vh-Werte korrekt bleiben.
  const [lyricsProviders, setLyricsProviders] = useState(() => {
    const validIds = new Set(DEFAULT_LYRICS_PROVIDERS.map(p => p.id));
    try {
      const saved = localStorage.getItem("kiyoshi-lyrics-providers");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Remove providers that no longer exist (e.g. old Kimuco entry)
        const filtered = parsed.filter(p => validIds.has(p.id));
        // Add any new default providers not yet in the saved list
        const ids = filtered.map(p => p.id);
        const merged = [...filtered, ...DEFAULT_LYRICS_PROVIDERS.filter(p => !ids.includes(p.id))];
        return merged;
      }
    } catch {}
    return DEFAULT_LYRICS_PROVIDERS;
  });
  // Migration: add newly introduced providers / remove obsolete ones
  useEffect(() => {
    const validIds = new Set(DEFAULT_LYRICS_PROVIDERS.map(p => p.id));
    setLyricsProviders(current => {
      const filtered = current.filter(p => validIds.has(p.id));
      const ids = filtered.map(p => p.id);
      const missing = DEFAULT_LYRICS_PROVIDERS.filter(p => !ids.includes(p.id));
      if (missing.length === 0 && filtered.length === current.length) return current;
      const merged = [...filtered, ...missing];
      localStorage.setItem("kiyoshi-lyrics-providers", JSON.stringify(merged));
      return merged;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem("kiyoshi-autoplay") !== "false");
  const [crossfade, setCrossfade] = useState(() => {
    const s = parseInt(localStorage.getItem("kiyoshi-crossfade"));
    return isNaN(s) ? 0 : s;
  });

  // ── Profile / Auth ──
  const [profiles, setProfiles] = useState([]);
  const [hasProfile, setHasProfile] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(() => !localStorage.getItem("kiyoshi-lang"));
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(null);

  // ── fetchProfiles + loadCachedProfile must be declared before any effect that uses them ──

  const fetchProfiles = useCallback(async () => {
    try {
      const r = await fetch(`${API}/profiles`);
      const d = await r.json();
      // Persist for offline fallback
      try { localStorage.setItem("kiyoshi-profiles-cache", JSON.stringify({ profiles: d.profiles || [], current: d.current || null })); } catch {}
      setProfiles(d.profiles || []);
      setCurrentProfile(d.current || null);
      setHasProfile((d.profiles || []).length > 0 && d.current);
      if (d.current) {
        window.__activeProfile = d.current;
        try { setPinnedIds(JSON.parse(localStorage.getItem(`kiyoshi-pinned-${d.current}`) || "[]").map(p => p.playlistId || p.browseId)); } catch {}
      }
    } catch {}
  }, []);

  // Load cached profile data when backend is unreachable (offline / slow start)
  const loadCachedProfile = useCallback(() => {
    try {
      const raw = localStorage.getItem("kiyoshi-profiles-cache");
      if (!raw) return false;
      const { profiles: cp, current } = JSON.parse(raw);
      if (!cp?.length || !current) return false;
      setProfiles(cp);
      setCurrentProfile(current);
      setHasProfile(true);
      window.__activeProfile = current;
      try { setPinnedIds(JSON.parse(localStorage.getItem(`kiyoshi-pinned-${current}`) || "[]").map(p => p.playlistId || p.browseId)); } catch {}
      return true;
    } catch { return false; }
  }, []);

  // Keepalive ping to prevent server connection timeout
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API}/status`).catch(() => {});
    }, 30000); // ping every 30s
    return () => clearInterval(interval);
  }, []);

  // Load cached song IDs on mount (with retry for slow backend startup)
  useEffect(() => {
    let cancelled = false;
    const load = (attempt = 0) => {
      fetch(`${API}/song/cached/list`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setCachedSongIds(new Set((d.songs || []).map(s => s.videoId))); })
        .catch(() => { if (!cancelled && attempt < 20) setTimeout(() => load(attempt + 1), 1500); });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Detect real network connectivity changes
  useEffect(() => {
    const onOnline  = () => {
      setIsActuallyOffline(false);
      // Refresh profiles + force all views to re-fetch after coming back online
      fetchProfiles();
      setAppKey(k => k + 1);
    };
    const onOffline = () => setIsActuallyOffline(true);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [fetchProfiles]);

  // Debug float window toggle
  useEffect(() => {
    const handler = () => setDebugFloat(true);
    window.addEventListener("kiyoshi-debug-float", handler);
    return () => window.removeEventListener("kiyoshi-debug-float", handler);
  }, []);

  const isOffline = offlineMode || isActuallyOffline;

  const handleToggleOffline = useCallback(() => {
    setOfflineMode(prev => {
      const next = !prev;
      localStorage.setItem("kiyoshi-offline", String(next));
      if (next) setView("downloads");
      return next;
    });
  }, []);

  useEffect(() => {
    let bgIntervalId = null;

    // Show cached profile immediately so sidebar isn't empty during backend startup
    loadCachedProfile();

    // Check if we have a valid authenticated profile
    const checkAuth = async (retries = 15) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3000); // 3s timeout per attempt
        const r = await fetch(`${API}/auth/validate`, { signal: ctrl.signal });
        clearTimeout(tid);
        const d = await r.json();
        if (!d.valid && d.reason !== "adding_account") {
          // Auth invalid — clear stale cache and show login
          try { localStorage.removeItem("kiyoshi-profiles-cache"); } catch {}
          setShowLogin(true);
        } else {
          fetchProfiles();
          // Re-fetch after a short delay to pick up background avatar writes
          setTimeout(() => fetchProfiles(), 4000);
        }
      } catch {
        // Backend not ready yet - retry
        if (retries > 0) {
          setTimeout(() => checkAuth(retries - 1), 1500);
        } else {
          // All retries exhausted — cache already loaded above, show login only if no cache
          const raw = localStorage.getItem("kiyoshi-profiles-cache");
          let hasCache = false;
          try { const p = JSON.parse(raw || "{}"); hasCache = p.profiles?.length > 0 && p.current; } catch {}
          if (!hasCache) setShowLogin(true);
          // Keep pinging in background; once backend responds, sync live data
          bgIntervalId = setInterval(async () => {
            try {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 2000);
              const r = await fetch(`${API}/auth/validate`, { signal: ctrl.signal });
              clearTimeout(tid);
              const d = await r.json();
              if (bgIntervalId) { clearInterval(bgIntervalId); bgIntervalId = null; }
              if (d.valid || d.reason === "adding_account") {
                fetchProfiles();
              }
            } catch {}
          }, 3000);
        }
      }
    };
    // Give server time to start and load profiles (retries cover any remaining startup time)
    setTimeout(() => checkAuth(), 1000);

    return () => { if (bgIntervalId) { clearInterval(bgIntervalId); bgIntervalId = null; } };
  }, [fetchProfiles, loadCachedProfile]);

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    localStorage.setItem("kiyoshi-lang", lang);
  };

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      // Don't fire when typing in an input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const audio = audioRef.current;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (audio) { if (isPlaying) { audio.pause(); setIsPlaying(false); } else { audio.play(); setIsPlaying(true); } }
          break;
        case "ArrowRight":
          e.preventDefault();
          setCurrentTrack(t => {
            if (!t) return t;
            const idx = queue.findIndex(x => x.videoId === t.videoId);
            return idx < queue.length - 1 ? queue[idx + 1] : t;
          });
          break;
        case "ArrowLeft":
          e.preventDefault();
          setCurrentTrack(t => {
            if (!t) return t;
            const idx = queue.findIndex(x => x.videoId === t.videoId);
            return idx > 0 ? queue[idx - 1] : t;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          if (audio) { const dv = Math.min(1, Math.sqrt(audio.volume) + 0.02); audio.volume = dv * dv; }
          break;
        case "ArrowDown":
          e.preventDefault();
          if (audio) { const dv = Math.max(0, Math.sqrt(audio.volume) - 0.02); audio.volume = dv * dv; }
          break;
        case "Escape":
          setOverlayOpen(false);
          setQueueOpen(false);
          break;
        case "KeyF":
          setFullscreen(f => !f);
          break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, queue, audioRef]);

  // Mouse wheel volume control — only on player bar area
  useEffect(() => {
    const onWheel = (e) => {
      const audio = audioRef.current;
      if (!audio) return;
      // Only adjust volume when hovering over the volume area
      const playerBar = e.target.closest?.('[data-volume-area]');
      if (!playerBar) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.02 : -0.02;
      const dv = Math.min(1, Math.max(0, Math.sqrt(audio.volume) + delta));
      audio.volume = dv * dv;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [audioRef]);

  const [artistView, setArtistView] = useState(null);

  const openArtist = useCallback((item, fromView) => {
    setArtistView({ browseId: item.browseId, fromView: fromView || view });
    setView("artist");
    if (item.browseId && item.title) {
      addRecentPlaylist({ browseId: item.browseId, title: item.title, thumbnail: item.thumbnail || "", type: "artist" });
    }
  }, [view]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (audioRef.current) {
            if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
            else { audioRef.current.play(); setIsPlaying(true); }
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          // handled by Player internally via queue — trigger next
          break;
        case "ArrowUp":
          e.preventDefault();
          if (audioRef.current) { const dv = Math.min(1, Math.sqrt(audioRef.current.volume) + 0.02); audioRef.current.volume = dv * dv; }
          break;
        case "ArrowDown":
          e.preventDefault();
          if (audioRef.current) { const dv = Math.max(0, Math.sqrt(audioRef.current.volume) - 0.02); audioRef.current.volume = dv * dv; }
          break;
        case "KeyF":
          setFullscreen(f => {
            const next = !f;
            import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_fullscreen', { fullscreen: next }).catch(() => {}));
            return next;
          });
          break;
        case "Escape":
          setOverlayOpen(false);
          setQueueOpen(false);
          break;
        case "KeyS":
          // Shuffle — handled in Player, no direct access here
          break;
        case "KeyM":
          e.preventDefault();
          if (audioRef.current) {
            if (audioRef.current.volume > 0) {
              mutePrevVolumeRef.current = audioRef.current.volume;
              audioRef.current.volume = 0;
            } else {
              audioRef.current.volume = mutePrevVolumeRef.current || 0.5;
            }
          }
          break;
        case "KeyL":
          e.preventDefault();
          if (!currentTrack) break;
          if (overlayOpen) { setShowLyrics(l => !l); }
          else { setOverlayOpen(true); }
          break;
        case "Comma":
          e.preventDefault();
          if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
          break;
        case "Period":
          e.preventDefault();
          if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
          break;
        case "Equal":
          if (e.ctrlKey) {
            e.preventDefault();
            setUiZoom(z => { const idx = ZOOM_STEPS.indexOf(z); const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx >= 0 ? idx + 1 : 2)]; localStorage.setItem("kiyoshi-ui-zoom", next); return next; });
          }
          break;
        case "Minus":
          if (e.ctrlKey) {
            e.preventDefault();
            setUiZoom(z => { const idx = ZOOM_STEPS.indexOf(z); const next = ZOOM_STEPS[Math.max(0, idx >= 0 ? idx - 1 : 2)]; localStorage.setItem("kiyoshi-ui-zoom", next); return next; });
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, audioRef, overlayOpen, currentTrack, setUiZoom]);

  // Animated view wrapper
  const AnimatedView = useCallback(({ children }) => (
    <div key={view} style={{
      animation: animations ? "fadeSlideIn 0.32s cubic-bezier(0.34,1.56,0.64,1)" : "none",
    }}>
      {children}
    </div>
  ), [view, animations]);

  return (
    <IconContext.Provider value={{ weight: "bold" }}>
    <LangContext.Provider value={language}>
    <AnimationContext.Provider value={animations}>
    <FontScaleContext.Provider value={appFontScale}>
    <ZoomContext.Provider value={uiZoom}>
      <style>{GLOBAL_KEYFRAMES}</style>
      {showSplash && <SplashScreen fading={splashFading} />}
      {!ffmpegSetupDone && <FfmpegSetupScreen onDone={() => setFfmpegSetupDone(true)} />}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", bottom: 110, right: 20, zIndex: 99998, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none", zoom: uiZoom }}>
          {toasts.map(toast => (
            <div key={toast.id} style={{
              background: "var(--bg-elevated)",
              border: `1px solid ${toast.type === "error" ? "rgba(255,100,100,0.35)" : toast.type === "success" ? "rgba(100,220,130,0.35)" : "var(--border)"}`,
              color: toast.type === "error" ? "#ff7070" : toast.type === "success" ? "#6bdf96" : "var(--text-primary)",
              padding: "10px 16px", borderRadius: 10, fontSize: "var(--t13)", fontWeight: 500,
              boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
              animation: "fadeSlideIn 0.22s cubic-bezier(0.34,1.56,0.64,1)",
              maxWidth: 340,
            }}>
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {flashbang && (
        <div onAnimationEnd={() => setFlashbang(false)} style={{ position: "fixed", inset: 0, zIndex: 999999, pointerEvents: "none", background: "white", animation: "flashbangFade 3s ease-out forwards" }} />
      )}
      <div style={{ display: "flex", height: `${100 / uiZoom}vh`, background: "var(--bg-base)", position: "relative", cursor: fullscreen && !cursorVisible ? "none" : "default", zoom: uiZoom }}>
        {!fullscreen && <TitleBar />}
        <div style={{
          width: fullscreen ? 0 : (sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED),
          minWidth: fullscreen ? 0 : (sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED),
          overflow: "hidden", flexShrink: 0,
          transition: "width 0.3s cubic-bezier(0.4,0,0.2,1), min-width 0.3s cubic-bezier(0.4,0,0.2,1)",
        }}>
          <Sidebar view={view} setView={setView} onSearch={handleSearch} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(c => !c)} onOpenSettings={() => setSettingsOpen(true)} onOpenUpdateTab={() => { setSettingsInitialTab("update"); setSettingsOpen(true); }} onCloseOverlay={() => setOverlayOpen(false)} onOpenPlaylist={(pl) => openPlaylist(pl, view)} onOpenAlbum={(item) => openAlbum(item, view)} onOpenArtist={(item) => openArtist(item, view)} onAddRecent={addRecentPlaylist} onContextMenu={openContextMenu} currentProfileData={profiles.find(p => p.active)} onOpenProfileSwitcher={() => setShowProfileSwitcher(true)} profiles={profiles}
            onSwitchProfile={async (name) => {
              await fetch(`${API}/profiles/switch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
              await fetchProfiles();
              setView("home"); setCurrentTrack(null); setQueue([]); setCollection(null); setOverlayOpen(false); setQueueOpen(false); setSearchQuery(""); setAppKey(k => k + 1);
              window.__activeProfile = name; window.dispatchEvent(new CustomEvent("profile-switched"));
            }}
            onAddProfile={async () => {
              try { await fetch(`${API}/auth/begin-add`, { method: "POST" }); } catch {}
              setAddingProfile(true); setShowLogin(true);
            }}
            onDeleteProfile={async (name) => {
              const wasActive = profiles.find(p => p.name === name)?.active;
              await fetch(`${API}/profiles/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
              const remaining = profiles.filter(p => p.name !== name);
              if (remaining.length === 0) { setView("home"); setCurrentTrack(null); setQueue([]); setCollection(null); setOverlayOpen(false); setQueueOpen(false); setHasProfile(false); setShowLogin(true); }
              else if (wasActive) {
                const next = remaining[0];
                await fetch(`${API}/profiles/switch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next.name }) });
                await fetchProfiles(); setView("home"); setCurrentTrack(null); setQueue([]); setCollection(null); setOverlayOpen(false); setQueueOpen(false);
                window.__activeProfile = next.name; window.dispatchEvent(new CustomEvent("profile-switched")); setAppKey(k => k + 1);
              } else { await fetchProfiles(); }
            }}
            onCreatePlaylist={() => setCreatePlaylistOpen(true)}
            updateInfo={updateInfo}
            offlineMode={offlineMode}
            isActuallyOffline={isActuallyOffline}
            onToggleOffline={handleToggleOffline}
          />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div key={appKey} className="scrollable" style={{ flex: 1, overflowY: "auto" }}>
            {view === "home" && <AnimatedView><HomeView displayName={profiles.find(p => p.active)?.displayName} onPlay={handlePlay} onOpenPlaylist={(item) => openPlaylist(item, "home")} onOpenAlbum={(item) => openAlbum(item, "home")} onOpenArtist={(item) => openArtist(item, "home")} onContextMenu={openContextMenu} onTrackContextMenu={(e, track) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track })} /></AnimatedView>}
            {view === "search" && <AnimatedView><SearchView query={searchQuery} onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onOpenArtist={openArtist} onOpenAlbum={(item) => openAlbum(item, "search")} onOpenPlaylist={(item) => openPlaylist(item, "search")} onContextMenu={openContextMenu} onTrackContextMenu={(e, track) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track })} /></AnimatedView>}
            {view === "liked" && <AnimatedView><LikedView onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onOpenArtist={openArtist} onOpenAlbum={(item) => openAlbum(item, "liked")} onTrackContextMenu={(e, track) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track })} cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} onDownloadSong={handleDownloadSong} hideExplicit={hideExplicit} /></AnimatedView>}
            {view === "history" && <AnimatedView><HistoryView onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onOpenArtist={openArtist} onOpenAlbum={(item) => openAlbum(item, "history")} onTrackContextMenu={(e, track, extra) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track, ...extra })} cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} onDownloadSong={handleDownloadSong} /></AnimatedView>}
            {view === "library" && <AnimatedView><LibraryView onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onOpenPlaylist={openPlaylist} onOpenAlbum={openAlbum} onOpenArtist={openArtist} onContextMenu={openContextMenu} /></AnimatedView>}
            {view === "collection" && collection && <AnimatedView><CollectionView title={collection.title} thumbnail={collection.thumbnail} tracks={collection.tracks} total={collection.total} loading={collection.loading} progress={collection.progress || 0} cached={collection.cached} onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onBack={() => setView(collection.fromView || "library")} onOpenArtist={openArtist} onOpenAlbum={(item) => openAlbum(item, "collection")} isAlbum={collection.isAlbum} albumArtists={collection.albumArtists} albumArtistBrowseId={collection.albumArtistBrowseId} year={collection.year} onRefresh={() => { if (collection.isAlbum) openAlbum({ browseId: collection.browseId, title: collection.title, thumbnail: collection.thumbnail }, collection.fromView, true); else openPlaylist({ playlistId: collection.playlistId, title: collection.title, thumbnail: collection.thumbnail, forcedTitle: collection.forcedTitle }, collection.fromView, true); }} onTrackContextMenu={(e, track) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track, playlistId: collection.isAlbum ? null : collection.playlistId })} cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} premiumSongIds={premiumSongIds} onDownloadSong={handleDownloadSong} onDownloadAll={(tracks) => handleDownloadAll(tracks, { title: collection.title, thumbnail: collection.thumbnail, artists: collection.albumArtists || "" })} onRemoveAll={handleRemoveAllDownloads} hideExplicit={hideExplicit} /></AnimatedView>}
            {view === "artist" && artistView && <AnimatedView><ArtistView browseId={artistView.browseId} onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} onOpenAlbum={(item) => openAlbum(item, "artist")} onOpenPlaylist={(item) => openPlaylist(item, "artist")} onBack={() => setView(artistView.fromView || "library")} onContextMenu={openContextMenu} onTogglePin={togglePin} isPinned={pinnedIds.includes(artistView.browseId)} /></AnimatedView>}
            {view === "downloads" && <AnimatedView><DownloadsView onPlay={handlePlay} currentTrack={currentTrack} isPlaying={isPlaying} cachedSongIds={cachedSongIds} downloadingIds={downloadingIds} premiumSongIds={premiumSongIds} onDownloadSong={handleDownloadSong} onTrackContextMenu={(e, track) => setTrackContextMenu({ x: e.clientX, y: e.clientY, track })} hideExplicit={hideExplicit} /></AnimatedView>}
            {isOffline && view !== "downloads" && (
              <div style={{
                position: "sticky", bottom: 0, left: 0, right: 0,
                background: "rgba(240,180,41,0.12)", borderTop: "1px solid rgba(240,180,41,0.3)",
                color: "#f0b429", display: "flex", alignItems: "center", gap: 8,
                padding: "6px 16px", fontSize: 13, zIndex: 10,
              }}>
                <WifiX size={15} weight="bold" />
                {translate(language, "offlineBanner")}
              </div>
            )}
          </div>
          <div style={{
            opacity: !fullscreen || playerVisible ? 1 : 0,
            visibility: !fullscreen || playerVisible ? "visible" : "hidden",
            transition: "opacity 0.5s ease, visibility 0.5s ease",
            flexShrink: 0,
            pointerEvents: !fullscreen || playerVisible ? "auto" : "none",
            position: fullscreen ? "relative" : "relative",
            zIndex: fullscreen ? 105 : "auto",
          }}>
          <Player
            track={currentTrack}
            setTrack={setCurrentTrack}
            queue={queue}
            setQueue={setQueue}
            audioRef={audioRef}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            expanded={overlayOpen}
            onExpandToggle={() => setOverlayOpen(e => !e)}
            showLyrics={showLyrics}
            onToggleLyrics={() => {
              if (!overlayOpen) {
                setOverlayOpen(true);
                setShowLyrics(true);
              } else {
                setShowLyrics(l => !l);
              }
            }}
            queueOpen={queueOpen}
            onToggleQueue={() => setQueueOpen(q => !q)}
            crossfade={crossfade}
            fullscreen={fullscreen}
            onToggleFullscreen={async () => {
              const { invoke } = await import('@tauri-apps/api/core');
              const next = !fullscreen;
              try { await invoke('set_fullscreen', { fullscreen: next }); } catch(e) { console.error(e); }
              setFullscreen(next);
            }}
            onOpenAlbum={openAlbum}
            onOpenArtist={openArtist}
            onExportSong={handleExportSong}
            onRefetchLyrics={() => { setForcedLyricsProvider(null); setLyricsRefetchKey(k => k + 1); }}
            lyricsProviders={lyricsProviders}
            currentLyricsSource={currentLyricsSource}
            onSwitchLyricsProvider={(id) => setForcedLyricsProvider(id)}
            failedLyricsProviders={failedLyricsProviders}
            language={language}
            showLyricsTranslation={showLyricsTranslation}
            onToggleLyricsTranslation={() => {
              const next = !showLyricsTranslation;
              setShowLyricsTranslation(next);
              localStorage.setItem("kiyoshi-lyrics-translation", String(next));
            }}
            lyricsTranslationLang={lyricsTranslationLang}
            onSetLyricsTranslationLang={(lang) => {
              setLyricsTranslationLang(lang);
              localStorage.setItem("kiyoshi-lyrics-translation-lang", lang);
            }}
            showRomaji={showRomaji}
            onToggleRomaji={() => {
              const next = !showRomaji;
              setShowRomaji(next);
              localStorage.setItem("kiyoshi-lyrics-romaji", String(next));
            }}
            isCustomLyrics={isCustomLyrics}
            onImportLyrics={() => importLyricsRef.current?.()}
            onRemoveCustomLyrics={() => removeCustomLyricsRef.current?.()}
            onPremiumDetected={(videoId) => setPremiumSongIds(prev => new Set(prev).add(videoId))}
          />
          </div>
        </div>
        <div style={{
          position: "absolute",
          top: overlayOpen ? 0 : "100%",
          left: fullscreen ? 0 : (sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED),
          right: queueOpen ? 320 : 0, bottom: fullscreen ? 0 : 69, zIndex: fullscreen ? 102 : 100,
          transition: animations ? "top 0.4s cubic-bezier(0.34,1.56,0.64,1), right 0.3s ease" : "top 0.1s ease",
          pointerEvents: overlayOpen ? "all" : "none",
        }}>
          {currentTrack && (showLyrics
            ? <LyricsOverlay track={currentTrack} audioRef={audioRef} onClose={() => setOverlayOpen(false)} fontSize={lyricsFontSize} providers={lyricsProviders} refetchKey={lyricsRefetchKey} onAddToast={addToast} language={language} forcedProvider={forcedLyricsProvider} onSourceChange={setCurrentLyricsSource} onProviderFailed={(id) => setFailedLyricsProviders(s => new Set([...s, id]))} showTranslation={showLyricsTranslation} translationLang={lyricsTranslationLang} translationFontSize={lyricsTranslationFontSize} showRomaji={showRomaji} romajiFontSize={lyricsRomajiFontSize} onCustomLyricsStatusChange={setIsCustomLyrics} importLyricsRef={importLyricsRef} removeCustomLyricsRef={removeCustomLyricsRef} showAgentTags={showAgentTags} ambientVisualizer={ambientVisualizer} />
            : <CoverView track={currentTrack} isPlaying={isPlaying} onClose={() => setOverlayOpen(false)} ambientVisualizer={ambientVisualizer} />
          )}
        </div>

        {/* Queue panel */}
        <div style={{
          position: "absolute",
          top: 0, right: queueOpen ? 0 : -320,
          width: 320, bottom: fullscreen ? 0 : 69, zIndex: fullscreen ? 104 : 101,
          background: "var(--bg-surface)", borderLeft: "0.5px solid var(--border)",
          transition: animations ? "right 0.3s cubic-bezier(0.4,0,0.2,1)" : "right 0.1s ease",
          display: "flex", flexDirection: "column",
          pointerEvents: queueOpen ? "all" : "none",
        }}>
          <QueuePanel
            queue={queue}
            setQueue={setQueue}
            currentTrack={currentTrack}
            setTrack={setCurrentTrack}
            onClose={() => setQueueOpen(false)}
          />
        </div>
        {/* Language picker - shown only on very first launch */}
      {showLogin && showLangPicker && (
        <LanguagePickerScreen
          currentLanguage={language}
          onConfirm={(lang) => {
            setLanguage(lang);
            localStorage.setItem("kiyoshi-lang", lang);
            setShowLangPicker(false);
          }}
        />
      )}

        {/* Login Screen - shown when no profile exists */}
      {showLogin && !showLangPicker && (
        <LoginScreen
          onSuccess={() => { fetchProfiles(); setShowLogin(false); setAddingProfile(false); }}
          onCancel={addingProfile ? () => { setShowLogin(false); setAddingProfile(false); } : undefined}
        />
      )}


      {settingsOpen && (
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            accent={accent}
            onAccentChange={handleAccentChange}
            theme={theme}
            onThemeChange={handleThemeChange}
            animations={animations}
            onAnimationsChange={v => { setAnimations(v); localStorage.setItem("kiyoshi-animations", v); }}
            lyricsFontSize={lyricsFontSize}
            onLyricsFontSizeChange={v => { setLyricsFontSize(v); localStorage.setItem("kiyoshi-lyrics-font-size", v); }}
            lyricsTranslationFontSize={lyricsTranslationFontSize}
            onLyricsTranslationFontSizeChange={v => { setLyricsTranslationFontSize(v); localStorage.setItem("kiyoshi-lyrics-translation-font-size", v); }}
            lyricsRomajiFontSize={lyricsRomajiFontSize}
            onLyricsRomajiFontSizeChange={v => { setLyricsRomajiFontSize(v); localStorage.setItem("kiyoshi-lyrics-romaji-font-size", v); }}
            lyricsProviders={lyricsProviders}
            onLyricsProvidersChange={v => { setLyricsProviders(v); localStorage.setItem("kiyoshi-lyrics-providers", JSON.stringify(v)); }}
            autoplay={autoplay}
            onAutoplayChange={v => { setAutoplay(v); localStorage.setItem("kiyoshi-autoplay", v); }}
            crossfade={crossfade}
            onCrossfadeChange={v => { setCrossfade(v); localStorage.setItem("kiyoshi-crossfade", v); }}
            discordRpc={discordRpc}
            onDiscordRpcChange={(v) => { setDiscordRpc(v); localStorage.setItem("kiyoshi-discord-rpc", v); if (!v) import("@tauri-apps/api/core").then(({ invoke }) => invoke("clear_discord_rpc").catch(() => {})); }}
            language={language}
            onLanguageChange={handleLanguageChange}
            updateInfo={updateInfo}
            onCheckUpdate={checkForUpdates}
            updateDownloading={updateDownloading}
            updateDownloadProgress={updateDownloadProgress}
            updateDownloaded={updateDownloaded}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
            onCancelDownload={cancelUpdateDownload}
            initialTab={settingsInitialTab}
            onTabOpened={() => setSettingsInitialTab(null)}
            hideExplicit={hideExplicit}
            onHideExplicitChange={v => { setHideExplicit(v); localStorage.setItem("kiyoshi-hide-explicit", v); }}
            uiZoom={uiZoom}
            onUiZoomChange={v => { setUiZoom(v); localStorage.setItem("kiyoshi-ui-zoom", v); }}
            appFontScale={appFontScale}
            onFontScaleChange={v => { setAppFontScale(v); localStorage.setItem("kiyoshi-font-scale", v); }}
            showRomaji={showRomaji}
            onToggleRomaji={() => { const next = !showRomaji; setShowRomaji(next); localStorage.setItem("kiyoshi-lyrics-romaji", String(next)); }}
            showAgentTags={showAgentTags}
            onToggleAgentTags={() => { const next = !showAgentTags; setShowAgentTags(next); localStorage.setItem("kiyoshi-lyrics-agent-tags", String(next)); }}
            highContrast={highContrast}
            onToggleHighContrast={() => {
              const next = !highContrast;
              setHighContrast(next);
              document.documentElement.setAttribute("data-highcontrast", String(next));
              localStorage.setItem("kiyoshi-high-contrast", String(next));
            }}
            appFont={appFont}
            onAppFontChange={handleAppFontChange}
            ambientVisualizer={ambientVisualizer}
            onToggleAmbientVisualizer={() => {
              const next = !ambientVisualizer;
              setAmbientVisualizer(next);
              localStorage.setItem("kiyoshi-ambient-visualizer", String(next));
            }}
          />
        )}

        {/* Debug Floating Window */}
        {debugFloat && <DebugFloatingWindow onClose={() => setDebugFloat(false)} />}

        {/* Create Playlist Modal */}
        {createPlaylistOpen && (
          <CreatePlaylistModal
            t={(key) => translate(language, key)}
            onClose={() => setCreatePlaylistOpen(false)}
            onCreated={(id, title) => {
              openPlaylist({ playlistId: id, title, thumbnail: "" }, view);
            }}
          />
        )}

        {/* Download Queue Panel */}
        {downloadBatches.length > 0 && (
          <div style={{
            position: "fixed", bottom: 90, right: 16, zIndex: 8000,
            background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
            borderRadius: "var(--radius-lg)", padding: "10px 12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            display: "flex", flexDirection: "column", gap: 8,
            width: 300,
            maxHeight: 320, overflowY: "auto",
            animation: "ctxMenuIn 0.18s ease-out",
          }}>
            <div style={{ fontSize: "var(--t11)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
              {translate(language, "downloadQueue")}
            </div>
            {downloadBatches.map(batch => {
              const total = batch.videoIds.length;
              const done = batch.completedCount + batch.errorCount;
              const isFinished = done >= total;
              const pct = Math.round((batch.completedCount / total) * 100);
              return (
                <div key={batch.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {batch.thumbnail
                    ? <img src={thumb(batch.thumbnail)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--bg-hover)", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--t12)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{batch.title}</div>
                    {batch.artists && <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>{batch.artists}</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${pct}%`,
                          background: isFinished ? "#4caf50" : "var(--accent)",
                          transition: "width 0.5s ease, background 0.3s",
                        }} />
                      </div>
                      <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", flexShrink: 0, minWidth: 28, textAlign: "right" }}>
                        {pct}%
                      </div>
                    </div>
                    <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)", marginTop: 1 }}>
                      {done} {translate(language, "xOfY")} {total}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Track context menu */}
        {trackCtxData && (
          <>
            <div onClick={() => { setTrackContextMenu(null); setTrackCtxPlaylists(null); }} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
            <div style={{
              position: "fixed", ...clampMenu(trackCtxData.x / uiZoom, trackCtxData.y / uiZoom, 220, 360), zIndex: 9999,
              background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
              borderRadius: "var(--radius-lg)", padding: "4px", minWidth: 200,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              display: "flex", flexDirection: "column", gap: 2,
              animation: trackCtxClosing ? "ctxMenuOut 0.14s ease-in forwards" : "ctxMenuIn 0.14s ease-out",
              transformOrigin: "top left",
            }}>
              {/* Add to Playlist */}
              <div style={{ position: "relative" }}
                onMouseEnter={() => {
                  if (!trackCtxPlaylists) {
                    fetch(`${API}/library/playlists`).then(r => r.json()).then(d => setTrackCtxPlaylists(d.playlists || [])).catch(() => setTrackCtxPlaylists([]));
                  }
                }}
                onMouseLeave={() => setTrackCtxPlaylists(null)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Plus size={14} />
                    {translate(language, "addToPlaylist")}
                  </span>
                  <CaretDown size={10} style={{ transform: "rotate(-90deg)" }} />
                </div>
                {/* Submenu */}
                {trackCtxPlaylists && (
                  <div style={{
                    position: "absolute", left: "100%", top: 0, marginLeft: 4,
                    background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
                    borderRadius: "var(--radius-lg)", padding: "4px", minWidth: 180,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)", maxHeight: 300, overflowY: "auto",
                  }}>
                    {trackCtxPlaylists.map((pl, i) => (
                      <div key={i}
                        onClick={async () => {
                          try {
                            await fetch(`${API}/playlist/${pl.playlistId}/add`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ videoIds: [trackCtxData.track.videoId], tracks: [trackCtxData.track] }),
                            });
                          } catch {}
                          setTrackContextMenu(null);
                          setTrackCtxPlaylists(null);
                        }}
                        style={{ padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t12)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >{pl.title}</div>
                    ))}
                    <div style={{ borderTop: "0.5px solid var(--border)", margin: "4px 0" }} />
                    <div
                      onClick={() => { setTrackContextMenu(null); setTrackCtxPlaylists(null); setCreatePlaylistOpen(true); }}
                      style={{ padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t12)", color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <Plus size={12} weight="bold" />
                      {translate(language, "newPlaylist")}
                    </div>
                  </div>
                )}
              </div>

              {/* Remove from Playlist (only if viewing a user playlist) */}
              {trackCtxData.playlistId && trackCtxData.track.setVideoId && (
                <div
                  onClick={async () => {
                    try {
                      await fetch(`${API}/playlist/${trackCtxData.playlistId}/remove`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ videos: [{ videoId: trackCtxData.track.videoId, setVideoId: trackCtxData.track.setVideoId }] }),
                      });
                      // Optimistically remove from collection
                      setCollection(c => c ? { ...c, tracks: c.tracks.filter(t => t.videoId !== trackCtxData.track.videoId || t.setVideoId !== trackCtxData.track.setVideoId) } : c);
                    } catch {}
                    setTrackContextMenu(null);
                    setTrackCtxPlaylists(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-danger, #e05252)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <X size={14} />
                  {translate(language, "removeFromPlaylist")}
                </div>
              )}

              {/* Remove from History */}
              {trackCtxData.removeFromHistory && (
                <div
                  onClick={() => {
                    trackCtxData.removeFromHistory();
                    setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-danger, #e05252)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <X size={14} />
                  {translate(language, "removeFromHistory")}
                </div>
              )}

              {/* Navigate to Album / Artist */}
              {(trackCtxData.track.albumBrowseId || trackCtxData.track.artistBrowseId) && (
                <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />
              )}
              {trackCtxData.track.albumBrowseId && (
                <div
                  onClick={() => { const t = trackCtxData.track; setTrackContextMenu(null); setTrackCtxPlaylists(null); openAlbum({ browseId: t.albumBrowseId, title: t.album }, view); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <VinylRecord size={14} />
                  {translate(language, "goToAlbum")}
                </div>
              )}
              {trackCtxData.track.artistBrowseId && (
                <div
                  onClick={() => { const t = trackCtxData.track; setTrackContextMenu(null); setTrackCtxPlaylists(null); openArtist({ browseId: t.artistBrowseId }, view); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <Microphone size={14} />
                  {translate(language, "goToArtist")}
                </div>
              )}

              {/* Download / Remove download */}
              {cachedSongIds.has(trackCtxData.track.videoId) ? (
                <div
                  onClick={async () => {
                    try {
                      await fetch(`${API}/song/cached/${trackCtxData.track.videoId}`, { method: "DELETE" });
                      setCachedSongIds(prev => { const s = new Set(prev); s.delete(trackCtxData.track.videoId); return s; });
                    } catch {}
                    setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-danger, #e05252)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <Trash size={14} />
                  {translate(language, "removeDownload")}
                </div>
              ) : !downloadingIds.has(trackCtxData.track.videoId) && (
                <div
                  onClick={() => {
                    handleDownloadSong(trackCtxData.track);
                    setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <DownloadSimple size={14} />
                  {translate(language, "download")}
                </div>
              )}

              {/* Save as MP3 */}
              <div
                onClick={async () => {
                  const track = trackCtxData.track;
                  setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  handleExportSong(track, "mp3");
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <MusicNote size={14} />
                {translate(language, "saveAsMp3")}
              </div>

              {/* Save as OPUS */}
              <div
                onClick={async () => {
                  const track = trackCtxData.track;
                  setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  handleExportSong(track, "opus");
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <MusicNote size={14} />
                {translate(language, "saveAsOpus")}
              </div>

              {/* LRC actions */}
              <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />
              <div
                onClick={() => {
                  const track = trackCtxData.track;
                  setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  // Fetch lyrics for this track then copy
                  fetch(`${API}/lyrics/${track.videoId}`).then(r => r.json()).then(d => {
                    if (!d.lyrics) return;
                    const text = d.lyrics.map(l => l.wordSync ? l.words.map(w => w.text).join("") : (l.text || "")).join("\n");
                    navigator.clipboard.writeText(text).catch(() => {});
                  }).catch(() => {});
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <Copy size={14} />
                {translate(language, "copyLyrics")}
              </div>
              <div
                onClick={async () => {
                  const track = trackCtxData.track;
                  setTrackContextMenu(null); setTrackCtxPlaylists(null);
                  try {
                    const d = await fetch(`${API}/lyrics/${track.videoId}`).then(r => r.json());
                    if (!d.lyrics) return;
                    const lyrics = d.lyrics;
                    const isSync = lyrics.some(l => l.time >= 0);
                    const lrcText = isSync
                      ? lyrics.map(l => {
                          const lineText = l.wordSync ? l.words.map(w => w.text).join("") : (l.text || "");
                          if (l.time < 0) return lineText;
                          const mm = String(Math.floor(l.time / 60)).padStart(2, "0");
                          const ss = String(Math.floor(l.time % 60)).padStart(2, "0");
                          const cs = String(Math.floor((l.time % 1) * 100)).padStart(2, "0");
                          return `[${mm}:${ss}.${cs}] ${lineText}`;
                        }).join("\n")
                      : lyrics.map(l => l.wordSync ? l.words.map(w => w.text).join("") : (l.text || "")).join("\n");
                    const { save } = await import("@tauri-apps/plugin-dialog");
                    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
                    const safeTitle = (track?.title || "lyrics").replace(/[<>:"/\\|?*]/g, "_");
                    const filePath = await save({
                      title: translate(language, "saveLrc"),
                      defaultPath: `${safeTitle}.lrc`,
                      filters: [{ name: "LRC", extensions: ["lrc"] }, { name: "Text", extensions: ["txt"] }],
                    });
                    if (!filePath) return;
                    await writeTextFile(filePath, lrcText);
                  } catch (e) { console.error(e); }
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <DownloadSimple size={14} />
                {translate(language, "saveLrc")}
              </div>
            </div>
          </>
        )}

        {/* Global playlist context menu */}
        {globalCtxData && (
          <>
            <div onClick={() => setGlobalContextMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
            <div style={{
              position: "fixed", ...clampMenu(globalCtxData.x / uiZoom, globalCtxData.y / uiZoom, 200, 280), zIndex: 9999,
              background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
              borderRadius: "var(--radius-lg)", padding: "4px", minWidth: 180,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              display: "flex", flexDirection: "column", gap: 2,
              animation: globalCtxClosing ? "ctxMenuOut 0.14s ease-in forwards" : "ctxMenuIn 0.14s ease-out",
              transformOrigin: "top left",
            }}>
              <div
                onClick={() => { togglePin(globalCtxData.playlist); setGlobalContextMenu(null); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <PushPin size={14} />
                {pinnedIds.includes(itemId(globalCtxData.playlist)) ? translate(language, "unpin") : translate(language, "pin")}
              </div>
              <div
                onClick={() => {
                  const item = globalCtxData.playlist;
                  if (item?.type === "album") openAlbum(item, view);
                  else if (item?.type === "artist") openArtist(item, view);
                  else openPlaylist(item, view);
                  setGlobalContextMenu(null);
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <DotsThreeVertical size={16} />
                {translate(language, "open")}
              </div>
              {/* Navigation: View Album / View Artist — separator only if at least one button will render */}
              {((globalCtxData.playlist?.browseId && globalCtxData.playlist?.type !== "artist") || globalCtxData.playlist?.artistBrowseId) && (
                <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />
              )}
              {globalCtxData.playlist?.browseId && globalCtxData.playlist?.type !== "artist" && (
                <div
                  onClick={() => { openAlbum(globalCtxData.playlist, view); setGlobalContextMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <VinylRecord size={14} />
                  {translate(language, "goToAlbum")}
                </div>
              )}
              {globalCtxData.playlist?.artistBrowseId && (
                <div
                  onClick={() => { openArtist({ browseId: globalCtxData.playlist.artistBrowseId }, view); setGlobalContextMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <Microphone size={14} />
                  {translate(language, "goToArtist")}
                </div>
              )}
              {/* Destructive actions */}
              {(globalCtxData.playlist?.playlistId && globalCtxData.playlist?.type !== "album") || !pinnedIds.includes(itemId(globalCtxData.playlist)) ? (
                <div style={{ height: "0.5px", background: "var(--border)", margin: "2px 8px" }} />
              ) : null}
              {/* Rename Playlist (only for user playlists, not albums) */}
              {globalCtxData.playlist?.playlistId && globalCtxData.playlist?.type !== "album" && (
                <div
                  onClick={() => { setRenameDialog({ playlistId: globalCtxData.playlist.playlistId, title: globalCtxData.playlist.title }); setGlobalContextMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-primary)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <PencilSimple size={14} />
                  {translate(language, "renamePlaylist")}
                </div>
              )}
              {/* Delete Playlist (only for user playlists, not albums) */}
              {globalCtxData.playlist?.playlistId && globalCtxData.playlist?.type !== "album" && (
                <div
                  onClick={() => { setDeleteDialog({ playlistId: globalCtxData.playlist.playlistId, title: globalCtxData.playlist.title }); setGlobalContextMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-danger, #e05252)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <Trash size={14} />
                  {translate(language, "deletePlaylist")}
                </div>
              )}
              {!pinnedIds.includes(itemId(globalCtxData.playlist)) && (
                <div
                  onClick={() => { removeRecentPlaylist(itemId(globalCtxData.playlist)); setGlobalContextMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontSize: "var(--t13)", color: "var(--text-danger, #e05252)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <X size={16} />
                  {translate(language, "removeFromRecent")}
                </div>
              )}
            </div>
          </>
        )}

        {/* Rename Playlist Dialog */}
        {renameDialog && (
          <>
            <div onClick={() => setRenameDialog(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000 }} />
            <div style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9001,
              background: "var(--bg-elevated)", borderRadius: 16, padding: 28, minWidth: 340,
              border: "0.5px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zoom: uiZoom,
            }}>
              <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 16 }}>{translate(language, "renamePlaylist")}</div>
              <input
                autoFocus
                defaultValue={renameDialog.title}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const newTitle = e.target.value.trim();
                    if (newTitle) {
                      try {
                        await fetch(`${API}/playlist/${renameDialog.playlistId}/edit`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ title: newTitle }),
                        });
                        window.dispatchEvent(new Event("kiyoshi-library-updated"));
                      } catch {}
                      setRenameDialog(null);
                    }
                  } else if (e.key === "Escape") setRenameDialog(null);
                }}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8, border: "0.5px solid var(--border)",
                  background: "var(--bg-main)", color: "var(--text-primary)", fontSize: "var(--t13)", outline: "none",
                  boxSizing: "border-box", marginBottom: 16,
                }}
              />
              <div style={{ fontSize: "var(--t11)", color: "var(--text-muted)" }}>Enter ↵</div>
            </div>
          </>
        )}

        {/* Delete Playlist Confirm Dialog */}
        {deleteDialog && (
          <>
            <div onClick={() => setDeleteDialog(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000 }} />
            <div style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9001,
              background: "var(--bg-elevated)", borderRadius: 16, padding: 28, minWidth: 340,
              border: "0.5px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zoom: uiZoom,
            }}>
              <div style={{ fontSize: "var(--t16)", fontWeight: 600, marginBottom: 8 }}>{translate(language, "deletePlaylist")}</div>
              <div style={{ fontSize: "var(--t13)", color: "var(--text-secondary)", marginBottom: 20 }}>
                {translate(language, "deletePlaylistConfirm")}
                <br /><strong>{deleteDialog.title}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setDeleteDialog(null)} style={{
                  padding: "8px 18px", borderRadius: 8, border: "0.5px solid var(--border)",
                  background: "var(--bg-main)", color: "var(--text-secondary)", fontSize: "var(--t13)", cursor: "pointer",
                }}>{translate(language, "cancel")}</button>
                <button onClick={async () => {
                  try {
                    await fetch(`${API}/playlist/${deleteDialog.playlistId}`, { method: "DELETE" });
                    window.dispatchEvent(new Event("kiyoshi-library-updated"));
                    removeRecentPlaylist(deleteDialog.playlistId);
                    if (view === "collection" && collection?.playlistId === deleteDialog.playlistId) setView("library");
                  } catch {}
                  setDeleteDialog(null);
                }} style={{
                  padding: "8px 18px", borderRadius: 8, border: "none",
                  background: "#e05252", color: "#fff", fontSize: "var(--t13)", fontWeight: 500, cursor: "pointer",
                }}>{translate(language, "removeAccountConfirm")}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </ZoomContext.Provider>
    </FontScaleContext.Provider>
    </AnimationContext.Provider>
    </LangContext.Provider>
    </IconContext.Provider>
  );
}
