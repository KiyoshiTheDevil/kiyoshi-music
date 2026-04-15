"""
Kiyoshi Music - Python Backend
Lokaler API-Server der ytmusicapi nutzt.
Starte mit: python server.py
"""

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from ytmusicapi import YTMusic
import sys, os, json, glob, threading, time, requests, sqlite3, uuid, collections

app = Flask(__name__)
CORS(app, origins=[
    "http://localhost:1421",    # Tauri dev server
    "tauri://localhost",         # Tauri production (Windows/Linux)
    "https://tauri.localhost",   # Tauri production (Tauri 2.x, WebView2)
    "http://tauri.localhost",    # fallback
    "http://localhost",
    "http://127.0.0.1",
])

# When frozen as a PyInstaller --onefile bundle store all user data in a
# platform-appropriate location so uninstallers can clean it up cleanly.
# In dev mode, keep data next to server.py for convenience.
if getattr(sys, 'frozen', False):
    if sys.platform == 'win32':
        # Windows: %LOCALAPPDATA%\dev.kiyoshi.music
        _base_dir = os.path.join(
            os.environ.get('LOCALAPPDATA', os.path.dirname(sys.executable)),
            'dev.kiyoshi.music'
        )
    else:
        # Linux / macOS: follow XDG Base Directory spec
        _base_dir = os.path.join(
            os.environ.get('XDG_DATA_HOME', os.path.expanduser('~/.local/share')),
            'dev.kiyoshi.music'
        )
else:
    _base_dir = os.path.dirname(os.path.abspath(__file__))

PROFILES_DIR = os.path.join(_base_dir, "profiles")
os.makedirs(PROFILES_DIR, exist_ok=True)

IMG_CACHE_DIR = os.path.join(_base_dir, "imgcache")
os.makedirs(IMG_CACHE_DIR, exist_ok=True)
IMG_CACHE_TTL = 30 * 24 * 3600  # 30 days

PLAYLIST_CACHE_DIR = os.path.join(_base_dir, "playlist_cache")
os.makedirs(PLAYLIST_CACHE_DIR, exist_ok=True)
PLAYLIST_CACHE_TTL = 24 * 3600  # 24 hours

ALBUM_CACHE_DIR = os.path.join(_base_dir, "album_cache")
os.makedirs(ALBUM_CACHE_DIR, exist_ok=True)
ALBUM_CACHE_TTL = 7 * 24 * 3600  # 7 days

SONG_CACHE_DIR = os.path.join(_base_dir, "song_cache")
os.makedirs(SONG_CACHE_DIR, exist_ok=True)

LYRICS_CACHE_DIR = os.path.join(_base_dir, "lyrics_cache")
os.makedirs(LYRICS_CACHE_DIR, exist_ok=True)

CUSTOM_LYRICS_DIR = os.path.join(_base_dir, "custom_lyrics")
os.makedirs(CUSTOM_LYRICS_DIR, exist_ok=True)

# Active YTMusic instance and current profile
_ytm = None
_current_profile = None
_PLAYLIST_CACHE_MAX = 20
_playlist_cache = collections.OrderedDict()  # in-memory LRU, max 20 entries

def _playlist_cache_put(playlist_id, data):
    """Insert/update entry and evict the oldest if over the size limit."""
    _playlist_cache[playlist_id] = data
    _playlist_cache.move_to_end(playlist_id)
    while len(_playlist_cache) > _PLAYLIST_CACHE_MAX:
        _playlist_cache.popitem(last=False)
_adding_account = False
_download_status = {}  # video_id -> "downloading" | "done" | "error"
_download_queue  = {}  # video_id -> {title, artists, thumbnail, status, progress (0-1)}

# Cache feature flags (can be toggled at runtime via /cache/settings)
_cache_enabled = {"playlists": True, "albums": True, "images": True, "songs": True, "lyrics": True}

# ─── Node.js PATH — set once at startup ──────────────────────────────────────
# yt-dlp needs Node.js for nsig (n-parameter) decryption on ALL requests,
# not only authenticated ones.  Calling this here guarantees it runs before
# the first request regardless of auth status.
def _ensure_node_in_path():
    """Add bundled node.exe directory to PATH so yt-dlp can find it via shutil.which."""
    import shutil
    if shutil.which("node"):
        return  # already in PATH
    # Search in multiple locations: the exe's directory and its parent.
    # In PyInstaller onefile mode sys.executable is the original .exe; in dev it's the Python interpreter.
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    candidates = [exe_dir]
    parent = os.path.dirname(exe_dir)
    if parent and parent != exe_dir:
        candidates.append(parent)
    for candidate in candidates:
        bundled = os.path.join(candidate, "node.exe")
        if os.path.isfile(bundled):
            os.environ["PATH"] = candidate + os.pathsep + os.environ.get("PATH", "")
            print(f"[ydl] added bundled node.exe to PATH: {bundled}", flush=True)
            return
    print("[ydl] node.exe not found — nsig decryption may fail for some tracks", flush=True)

_ensure_node_in_path()

# ─── Debug log ring buffer ───────────────────────────────────────────────────
import logging as _logging

_server_start_time = time.time()
_debug_log = collections.deque(maxlen=500)
_debug_log_lock = threading.Lock()

class _RingBufferHandler(_logging.Handler):
    """Logging handler that appends records to the ring buffer.
    Uses Python's standard logging module — safe in all PyInstaller modes."""
    def emit(self, record):
        try:
            msg = self.format(record)
            lvl = record.levelname
            if lvl == "WARNING":
                lvl = "WARN"
            elif lvl not in ("INFO", "ERROR", "WARN", "DEBUG"):
                lvl = "INFO"
            with _debug_log_lock:
                _debug_log.append({
                    "ts": time.time(),
                    "level": lvl,
                    "msg": msg,
                    "source": "backend",
                })
        except Exception:
            pass

_ring_handler = _RingBufferHandler()
_ring_handler.setFormatter(_logging.Formatter("%(name)s: %(message)s"))
_ring_handler.setLevel(_logging.DEBUG)
# Capture root logger + Werkzeug (Flask's HTTP request logger)
_logging.getLogger().addHandler(_ring_handler)
_logging.getLogger("werkzeug").addHandler(_ring_handler)
_logging.getLogger("werkzeug").setLevel(_logging.INFO)

# ─── Musixmatch (inoffizielle API) ───────────────────────────────────────────
_mx_token = None
_mx_token_expires = 0
MX_APP_ID  = "web-desktop-app-v1.0"
MX_BASE    = "https://apic-desktop.musixmatch.com/ws/1.1"
MX_HEADERS = {
    "authority":   "apic-desktop.musixmatch.com",
    "user-agent":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "cookie":      "x-mxm-token-guid=",
}

def _get_mx_token():
    """Holt oder erneuert den Musixmatch User-Token (10-Minuten-Cache)."""
    global _mx_token, _mx_token_expires
    if _mx_token and time.time() < _mx_token_expires:
        return _mx_token
    try:
        import requests as req
        r = req.get(f"{MX_BASE}/token.get",
                    params={"app_id": MX_APP_ID, "guid": "default"},
                    headers=MX_HEADERS, timeout=8)
        tok = r.json()["message"]["body"]["user_token"]
        _mx_token = tok
        _mx_token_expires = time.time() + 600
        return tok
    except Exception as e:
        print(f"[lyrics] Musixmatch token error: {e}", flush=True)
        return None

def _try_musixmatch(title, artist, duration=None):
    """Sucht einen Track auf Musixmatch und gibt RichSync (Word) oder Subtitle (LRC) zurück."""
    import json as _json, requests as req
    token = _get_mx_token()
    if not token:
        return None
    base = {"app_id": MX_APP_ID, "usertoken": token}

    # Track suchen
    try:
        sr = req.get(f"{MX_BASE}/track.search",
                     params={**base, "q_track": title, "q_artist": artist,
                             "s_track_rating": "desc", "page_size": 5},
                     headers=MX_HEADERS, timeout=8)
        track_list = sr.json()["message"]["body"]["track_list"]
    except Exception as e:
        print(f"[lyrics] Musixmatch search error: {e}", flush=True)
        return None
    if not track_list:
        return None
    track_id = track_list[0]["track"]["track_id"]
    bp = {**base, "track_id": track_id}

    # RichSync (Word-Sync)
    try:
        rr = req.get(f"{MX_BASE}/track.richsync.get",
                     params=bp, headers=MX_HEADERS, timeout=8)
        rb = rr.json()["message"]["body"]
        if rb and isinstance(rb, dict) and rb.get("richsync", {}).get("richsync_body"):
            richsync = _json.loads(rb["richsync"]["richsync_body"])
            if richsync:
                return {"source": "Musixmatch", "richsync": richsync, "synced": None, "plain": None}
    except Exception as e:
        print(f"[lyrics] Musixmatch richsync error: {e}", flush=True)

    # Fallback: Line-Sync (LRC)
    try:
        lr = req.get(f"{MX_BASE}/track.subtitle.get",
                     params={**bp, "subtitle_format": "lrc"},
                     headers=MX_HEADERS, timeout=8)
        lb = lr.json()["message"]["body"]
        if lb and isinstance(lb, dict) and lb.get("subtitle", {}).get("subtitle_body"):
            return {"source": "Musixmatch", "richsync": None,
                    "synced": lb["subtitle"]["subtitle_body"], "plain": None}
    except Exception as e:
        print(f"[lyrics] Musixmatch subtitle error: {e}", flush=True)

    return None

def _dir_size_and_count(path):
    """Return (total_bytes, file_count) for all files in a directory."""
    total, count = 0, 0
    try:
        for f in os.listdir(path):
            fp = os.path.join(path, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
                count += 1
    except Exception:
        pass
    return total, count


def _playlist_disk_path(playlist_id):
    profile = _current_profile or "default"
    safe = playlist_id.replace("/", "_").replace("\\", "_")
    return os.path.join(PLAYLIST_CACHE_DIR, f"{profile}_{safe}.json")

def _load_playlist_disk(playlist_id, ttl=PLAYLIST_CACHE_TTL):
    path = _playlist_disk_path(playlist_id)
    if not os.path.exists(path):
        return None
    if time.time() - os.path.getmtime(path) > ttl:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Invalidate old caches that don't have isExplicit yet
        tracks = data.get("tracks", [])
        if tracks and "isExplicit" not in tracks[0]:
            return None
        return data
    except Exception:
        return None

def _save_playlist_disk(playlist_id, data):
    path = _playlist_disk_path(playlist_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass

def _purge_playlist_cache(playlist_id):
    _playlist_cache.pop(playlist_id, None)
    p = _playlist_disk_path(playlist_id)
    if os.path.exists(p):
        os.remove(p)


def _album_disk_path(browse_id):
    safe = browse_id.replace("/", "_").replace("\\", "_")
    return os.path.join(ALBUM_CACHE_DIR, f"{safe}.json")

def _load_album_disk(browse_id):
    path = _album_disk_path(browse_id)
    if not os.path.exists(path):
        return None
    if time.time() - os.path.getmtime(path) > ALBUM_CACHE_TTL:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Invalidate old caches that don't have isExplicit yet
        tracks = data.get("tracks", [])
        if tracks and "isExplicit" not in tracks[0]:
            return None
        return data
    except Exception:
        return None

def _save_album_disk(browse_id, data):
    path = _album_disk_path(browse_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass

def profile_path(name):
    return os.path.join(PROFILES_DIR, f"{name}.json")

def meta_path(name):
    return os.path.join(PROFILES_DIR, f"{name}.meta.json")

def local_db_path(name):
    return os.path.join(PROFILES_DIR, f"{name}.db")

def is_local_profile(name):
    if not name:
        return False
    mp = meta_path(name)
    if not os.path.exists(mp):
        return False
    try:
        with open(mp) as f:
            return json.load(f).get("type") == "local"
    except Exception:
        return False

def get_local_db(name):
    """Öffnet/erstellt die SQLite-Datenbank für ein lokales Profil."""
    db = sqlite3.connect(local_db_path(name), check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS liked_songs (
            video_id TEXT PRIMARY KEY,
            title TEXT, artists TEXT, album TEXT,
            thumbnail TEXT, duration TEXT,
            liked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS playlists (
            playlist_id TEXT PRIMARY KEY,
            title TEXT, description TEXT,
            privacy TEXT DEFAULT 'PRIVATE',
            created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id TEXT, video_id TEXT,
            title TEXT, artists TEXT, album TEXT,
            thumbnail TEXT, duration TEXT,
            set_video_id TEXT,
            position INTEGER, added_at INTEGER
        );
    """)
    db.commit()
    return db

from contextlib import contextmanager

@contextmanager
def local_db(name):
    """Context-Manager um get_local_db — schließt die Verbindung garantiert."""
    db = get_local_db(name)
    try:
        yield db
    finally:
        db.close()

# Short-lived cookies that expire in minutes and break the session.
# YouTube rotates these via Set-Cookie but ytmusicapi doesn't update them.
_SHORT_LIVED_COOKIES = {
    '__Secure-1PSIDTS', '__Secure-3PSIDTS',
    'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
    'CONSISTENCY', 'YSC', '__Secure-YEC',
    'VISITOR_PRIVACY_METADATA', '__Secure-ROLLOUT_TOKEN',
}

def clean_headers_for_storage(headers):
    """Minimal cleanup: only remove headers that don't belong in API requests."""
    h = dict(headers)
    # content-encoding doesn't belong in outgoing request headers
    h.pop("content-encoding", None)
    # Ensure authorization header exists (ytmusicapi needs it to detect browser auth type)
    if "authorization" not in h:
        import hashlib
        cookie_str = h.get("cookie", "")
        sapisid = next((p.strip()[8:] for p in cookie_str.split(";")
                        if p.strip().startswith("SAPISID=")), "")
        if sapisid:
            ts = str(int(time.time()))
            sha = hashlib.sha1(f"{ts} {sapisid} https://music.youtube.com".encode()).hexdigest()
            h["authorization"] = f"SAPISIDHASH {ts}_{sha}"
    return h

def load_profile(name):
    global _ytm, _current_profile, _playlist_cache
    # Local profile: use unauthenticated YTMusic instance
    if is_local_profile(name):
        _ytm = YTMusic()
        _current_profile = name
        _playlist_cache.clear()
        return True
    path = profile_path(name)
    if not os.path.exists(path):
        return False
    # Ensure authorization header exists (may have been stripped by earlier bug)
    try:
        with open(path, "r") as f:
            raw = json.load(f)
        if "authorization" not in raw:
            cleaned = clean_headers_for_storage(raw)
            with open(path, "w") as f:
                json.dump(cleaned, f, indent=2)
    except Exception:
        pass
    _ytm = YTMusic(path)
    _current_profile = name
    _playlist_cache = {}
    return True

def get_ytmusic():
    if _ytm is None:
        raise Exception("Kein Profil aktiv. Bitte zuerst anmelden.")
    return _ytm

def _get_ydl_cookiefile():
    """Write the active profile's YouTube cookies as a Netscape cookies file for yt-dlp.
    Returns the file path, or None if no authenticated profile is active."""
    if not _current_profile or is_local_profile(_current_profile):
        return None
    try:
        with open(profile_path(_current_profile)) as f:
            headers = json.load(f)
        cookie_str = headers.get("cookie", "")
        if not cookie_str:
            return None
        cookie_file = os.path.join(PROFILES_DIR, f"{_current_profile}_ydl_cookies.txt")
        lines = ["# Netscape HTTP Cookie File\n"]
        for part in cookie_str.split(";"):
            part = part.strip()
            if "=" not in part:
                continue
            name, _, value = part.partition("=")
            name = name.strip()
            value = value.strip()
            if not name:
                continue
            secure = "TRUE" if name.startswith("__Secure-") or name.startswith("__Host-") else "FALSE"
            lines.append(f".youtube.com\tTRUE\t/\t{secure}\t2147483647\t{name}\t{value}\n")
        with open(cookie_file, "w", encoding="utf-8") as f:
            f.writelines(lines)
        return cookie_file
    except Exception:
        return None

def _apply_ydl_auth(ydl_opts):
    """Inject cookiefile into yt-dlp opts."""
    # Node PATH is set once at startup — no need to call here again.
    cookie_file = _get_ydl_cookiefile()
    if cookie_file:
        ydl_opts["cookiefile"] = cookie_file
    return ydl_opts

def get_profiles():
    profiles = []
    seen = set()
    # Google profiles — have a .json headers file
    for p in glob.glob(os.path.join(PROFILES_DIR, "*.json")):
        name = os.path.splitext(os.path.basename(p))[0]
        if name.endswith(".meta") or name in seen:
            continue
        mp = os.path.join(PROFILES_DIR, f"{name}.meta.json")
        meta = {}
        if os.path.exists(mp):
            with open(mp) as f:
                meta = json.load(f)
        if meta.get("type") == "local":
            continue  # handled in second pass
        seen.add(name)
        profiles.append({
            "name": name,
            "displayName": meta.get("displayName", name),
            "handle": meta.get("handle", ""),
            "avatar": meta.get("avatar", ""),
            "type": "google",
            "active": name == _current_profile,
        })
    # Local profiles — only have a .meta.json with type==local
    for mp in glob.glob(os.path.join(PROFILES_DIR, "*.meta.json")):
        name = os.path.splitext(os.path.splitext(os.path.basename(mp))[0])[0]
        if name in seen:
            continue
        try:
            with open(mp) as f:
                meta = json.load(f)
        except Exception:
            continue
        if meta.get("type") != "local":
            continue
        seen.add(name)
        profiles.append({
            "name": name,
            "displayName": meta.get("displayName", name),
            "handle": "",
            "avatar": "",
            "type": "local",
            "active": name == _current_profile,
        })
    return profiles

# Migrate legacy browser.json to profiles/
def migrate_legacy():
    legacy = os.path.join(os.path.dirname(__file__), "browser.json")
    if os.path.exists(legacy) and not get_profiles():
        import shutil
        dest = profile_path("default")
        shutil.copy(legacy, dest)
        meta = {"displayName": "Standard"}
        with open(os.path.join(PROFILES_DIR, "default.meta.json"), "w") as f:
            json.dump(meta, f)
        print("[i] browser.json zu profiles/default.json migriert")

# Auto-load first profile on startup
def fetch_account_info(profile_name):
    """Versucht den echten Kontonamen von YouTube Music zu holen."""
    if is_local_profile(profile_name):
        return  # Lokale Profile haben keinen YouTube-Account
    try:
        ytm_temp = YTMusic(profile_path(profile_name))
        # get_account_info gibt Name + Handle zurück
        info = ytm_temp.get_account_info()
        if info:
            meta_path = os.path.join(PROFILES_DIR, f"{profile_name}.meta.json")
            meta = {}
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
            meta["displayName"] = info.get("accountName", profile_name)
            meta["handle"] = info.get("channelHandle", "")
            meta["avatar"] = info.get("accountPhotoUrl", "")
            with open(meta_path, "w") as f:
                json.dump(meta, f)
    except Exception as e:
        print(f"[i] Account-Info nicht abrufbar: {e}")

def autoload():
    migrate_legacy()
    profiles = get_profiles()
    if profiles:
        name = profiles[0]["name"]
        load_profile(name)
        # Fetch real account name in background
        threading.Thread(target=fetch_account_info, args=(name,), daemon=True).start()

autoload()

# ─── Profile endpoints ───────────────────────────────────────────────────────

@app.route("/profiles")
def list_profiles():
    return jsonify({"profiles": get_profiles(), "current": _current_profile})

@app.route("/profiles/switch", methods=["POST"])
def switch_profile():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Name fehlt"}), 400
    if load_profile(name):
        # Refresh avatar/displayName in background so the UI gets the latest data
        import threading
        threading.Thread(target=fetch_account_info, args=(name,), daemon=True).start()
        return jsonify({"ok": True, "current": name})
    return jsonify({"error": f"Profil '{name}' nicht gefunden"}), 404

@app.route("/profiles/delete", methods=["POST"])
def delete_profile():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Name fehlt"}), 400
    path = profile_path(name)
    mp = meta_path(name)
    db = local_db_path(name)
    if os.path.exists(path):
        os.remove(path)
    if os.path.exists(mp):
        os.remove(mp)
    if os.path.exists(db):
        os.remove(db)
    global _current_profile, _ytm
    if _current_profile == name:
        _current_profile = None
        _ytm = None
        autoload()
    return jsonify({"ok": True})

@app.route("/profiles/rename", methods=["POST"])
def rename_profile():
    data = request.json or {}
    name = data.get("name")
    display_name = data.get("displayName")
    if not name or not display_name:
        return jsonify({"error": "Fehlende Parameter"}), 400
    meta_path = os.path.join(PROFILES_DIR, f"{name}.meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    meta["displayName"] = display_name
    with open(meta_path, "w") as f:
        json.dump(meta, f)
    return jsonify({"ok": True})

def parse_curl_to_dict(curl_str):
    """Extrahiert Headers aus einem cURL-Befehl (bash und Windows cmd Format)."""
    import re
    headers = {}

    # Normalize Windows cmd escaping
    curl_str = re.sub(r'\^\s*\n\s*', ' ', curl_str)   # ^ line continuation
    curl_str = curl_str.replace('^\\"', '\x00DQ\x00')  # ^\^" -> placeholder
    curl_str = curl_str.replace('^"', '"')              # ^" -> "
    curl_str = curl_str.replace('\x00DQ\x00', '"')      # restore inner quotes
    curl_str = curl_str.replace('^%^', '%')             # ^%^ -> %
    curl_str = curl_str.replace('^&', '&')              # ^& -> &

    # Extract -b "cookie_string" (Vivaldi puts cookies here)
    m = re.search(r'\s-b\s+"([^"]*)"', curl_str)
    if m:
        headers['cookie'] = m.group(1)

    # Extract all -H "key: value" entries
    for match in re.finditer(r'-H\s+"([^"]+?)"(?:\s|$)', curl_str):
        header = match.group(1)
        if ': ' in header:
            key, _, value = header.partition(': ')
            headers[key.lower().strip()] = value.strip()

    # bash format: -H 'key: value'
    for match in re.finditer(r"-H\s+'([^']+)'", curl_str):
        header = match.group(1)
        if ': ' in header:
            key, _, value = header.partition(': ')
            headers[key.lower().strip()] = value.strip()

    print(f"[i] Parsed {len(headers)} headers: {list(headers.keys())}", flush=True)
    return headers

def parse_raw_headers_to_dict(raw):
    """Parst rohe Headers (key: value Zeilen) in ein Dict."""
    headers = {}
    for line in raw.splitlines():
        if ': ' in line:
            key, _, value = line.partition(': ')
            headers[key.lower().strip()] = value.strip()
    return headers

@app.route("/auth/setup", methods=["POST"])
def setup_auth():
    """Empfängt cURL oder rohe Headers und erstellt ein neues Profil."""
    data = request.json or {}
    headers_raw = data.get("headers_raw", "").strip()
    profile_name = data.get("profile_name", "")
    display_name = data.get("display_name", profile_name)

    if not headers_raw or not profile_name:
        return jsonify({"error": "headers_raw und profile_name erforderlich"}), 400

    # Parse cURL or raw headers
    if headers_raw.startswith("curl "):
        headers = parse_curl_to_dict(headers_raw)
    else:
        headers = parse_raw_headers_to_dict(headers_raw)

    if "cookie" not in headers:
        return jsonify({"error": "The following entries are missing in your headers: cookie, x-goog-authuser. Please try a different request (such as /browse) and make sure you are logged in."}), 400

    if "x-goog-authuser" not in headers:
        headers["x-goog-authuser"] = "0"
    if "origin" not in headers:
        headers["origin"] = "https://music.youtube.com"
    if "x-origin" not in headers:
        headers["x-origin"] = "https://music.youtube.com"

    # Clean headers: strip short-lived cookies and static auth
    headers = clean_headers_for_storage(headers)

    path = profile_path(profile_name)
    with open(path, "w") as f:
        json.dump(headers, f, indent=2)

    meta_path = os.path.join(PROFILES_DIR, f"{profile_name}.meta.json")
    with open(meta_path, "w") as f:
        json.dump({"displayName": display_name}, f)

    try:
        ytm_temp = YTMusic(path)
        ytm_temp.get_liked_songs(limit=1)
        global _ytm, _current_profile, _playlist_cache
        _ytm = ytm_temp
        _current_profile = profile_name
        _playlist_cache.clear()
        threading.Thread(target=fetch_account_info, args=(profile_name,), daemon=True).start()
        return jsonify({"ok": True, "profile": profile_name})
    except Exception as e:
        if os.path.exists(path): os.remove(path)
        return jsonify({"error": str(e)}), 500


@app.route("/auth/cookie-login", methods=["POST"])
def cookie_login():
    """Empfängt Cookies direkt aus dem eingebetteten Browser-Fenster."""
    data = request.json or {}
    cookie_str = data.get("cookie", "")
    user_agent = data.get("user_agent", "Mozilla/5.0")
    profile_name = data.get("profile_name", "default")

    if not cookie_str:
        return jsonify({"error": "Keine Cookies"}), 400

    # Check for required auth cookies
    required = ["SAPISID", "SSID", "HSID"]
    has_auth = any(c in cookie_str for c in required)
    if not has_auth:
        return jsonify({"error": "Keine Auth-Cookies gefunden. Bitte erst einloggen."}), 400

    # Extract SAPISID for authorization header
    import hashlib, time
    sapisid = ""
    for part in cookie_str.split(";"):
        part = part.strip()
        if part.startswith("SAPISID="):
            sapisid = part[8:]
            break

    # Build browser.json format
    headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.5",
        "content-type": "application/json",
        "cookie": cookie_str,
        "origin": "https://music.youtube.com",
        "user-agent": user_agent,
        "x-origin": "https://music.youtube.com",
    }

    # Clean headers: strip short-lived cookies and static auth
    headers = clean_headers_for_storage(headers)

    path = profile_path(profile_name)
    with open(path, "w") as f:
        json.dump(headers, f, indent=2)

    # Try to initialize YTMusic
    try:
        ytm_temp = YTMusic(path)
        # Quick test
        ytm_temp.get_liked_songs(limit=1)
        global _ytm, _current_profile, _playlist_cache
        _ytm = ytm_temp
        _current_profile = profile_name
        _playlist_cache.clear()

        # Save meta
        meta_path = os.path.join(PROFILES_DIR, f"{profile_name}.meta.json")
        meta = {"displayName": profile_name.capitalize()}
        with open(meta_path, "w") as f:
            json.dump(meta, f)

        # Fetch real account name in background
        threading.Thread(target=fetch_account_info, args=(profile_name,), daemon=True).start()
        # Clear the "adding account" flag so validate returns valid
        global _adding_account
        _adding_account = False
        return jsonify({"ok": True, "profile": profile_name})
    except Exception as e:
        if os.path.exists(path):
            os.remove(path)
        return jsonify({"error": f"Login fehlgeschlagen: {str(e)}"}), 500

@app.route("/auth/validate")
def validate_auth():
    """Prüft ob das aktuelle Profil noch gültig ist."""
    if _adding_account:
        return jsonify({"valid": False, "reason": "adding_account"})
    if _ytm is None:
        return jsonify({"valid": False, "reason": "no_profile"})
    if _current_profile:
        # Local profile: check meta file exists
        if is_local_profile(_current_profile):
            if os.path.exists(meta_path(_current_profile)):
                return jsonify({"valid": True, "profile": _current_profile, "type": "local"})
            return jsonify({"valid": False, "reason": "no_profile"})
        # Google profile: check headers file exists
        if os.path.exists(profile_path(_current_profile)):
            return jsonify({"valid": True, "profile": _current_profile, "type": "google"})
    return jsonify({"valid": False, "reason": "no_profile"})

@app.route("/auth/local-create", methods=["POST"])
def local_create():
    """Erstellt ein neues lokales Profil ohne Google-Account."""
    data = request.json or {}
    display_name = (data.get("displayName") or "").strip()
    if not display_name:
        return jsonify({"error": "Name fehlt"}), 400
    # Sanitize to a filesystem-safe profile name
    import re
    base = re.sub(r'[^\w\-]', '_', display_name.lower())[:40] or "local"
    name = base
    counter = 1
    while os.path.exists(meta_path(name)):
        name = f"{base}_{counter}"
        counter += 1
    # Write meta
    os.makedirs(PROFILES_DIR, exist_ok=True)
    with open(meta_path(name), "w") as f:
        json.dump({"displayName": display_name, "type": "local"}, f)
    # Init SQLite schema
    with local_db(name):
        pass
    # Activate profile
    load_profile(name)
    return jsonify({"ok": True, "profile": name, "displayName": display_name})

@app.route("/auth/begin-add", methods=["POST"])
def begin_add():
    global _adding_account
    _adding_account = True
    return jsonify({"ok": True})

@app.route("/auth/end-add", methods=["POST"])
def end_add():
    global _adding_account
    _adding_account = False
    return jsonify({"ok": True})

def _lyrics_cache_key(title, artist, source):
    import hashlib
    raw = f"{title.lower().strip()}|{artist.lower().strip()}|{source}"
    return hashlib.md5(raw.encode()).hexdigest()

@app.route("/lyrics")
def get_lyrics():
    """Proxy für Lyrics-APIs um CSP-Probleme im Production Build zu umgehen."""
    title = request.args.get("title", "")
    artist = request.args.get("artist", "")
    album = request.args.get("album", "")
    duration = request.args.get("duration", "")
    source = request.args.get("source", "auto")
    video_id = request.args.get("videoId", "")

    # Check lyrics cache first
    if _cache_enabled.get("lyrics", True):
        cache_key = _lyrics_cache_key(title, artist, source)
        cache_path = os.path.join(LYRICS_CACHE_DIR, f"{cache_key}.json")
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return jsonify(json.load(f))
            except Exception:
                pass

    import requests as req
    result = None

    # 1. LRCLIB
    if source in ("auto", "lrclib"):
        try:
            r = req.get(f"https://lrclib.net/api/get",
                params={"artist_name": artist, "track_name": title},
                timeout=8)
            if r.ok:
                d = r.json()
                if d.get("syncedLyrics"):
                    result = {"source": "LRCLIB", "synced": d["syncedLyrics"], "plain": None}
                elif d.get("plainLyrics"):
                    result = {"source": "LRCLIB", "synced": None, "plain": d["plainLyrics"]}
        except Exception as e:
            print(f"[lyrics] LRCLIB error: {e}", flush=True)

    # 2. Better Lyrics
    if not result and source in ("auto", "better"):
        try:
            params = {"s": title, "a": artist}
            if album: params["al"] = album
            if duration: params["d"] = duration
            r = req.get("https://lyrics-api.boidu.dev/getLyrics", params=params, timeout=8)
            if r.ok:
                d = r.json()
                if d.get("ttml"):
                    result = {"source": "Better Lyrics", "ttml": d["ttml"]}
        except Exception as e:
            print(f"[lyrics] Better Lyrics error: {e}", flush=True)

    # 3. Kugou
    if not result and source in ("auto", "kugou"):
        try:
            import base64
            keyword = f"{title} {artist}".strip()
            duration_ms = int(float(duration) * 1000) if duration else 0

            # Step 1: search for song to get hash
            search_r = req.get(
                "https://mobilecdn.kugou.com/api/v3/search/song",
                params={"keyword": keyword, "page": 1, "pagesize": 5, "format": "json"},
                timeout=8
            )
            if search_r.ok:
                songs = search_r.json().get("data", {}).get("info", [])
                if songs:
                    hash_val = songs[0].get("hash", "")

                    # Step 2: get lyrics candidates
                    cand_r = req.get(
                        "https://lyrics.kugou.com/search",
                        params={
                            "ver": 1, "man": "yes", "client": "pc",
                            "keyword": f"{title} - {artist}",
                            "duration": duration_ms,
                            "hash": hash_val,
                        },
                        timeout=8
                    )
                    if cand_r.ok:
                        candidates = cand_r.json().get("candidates", [])
                        if candidates:
                            cand = candidates[0]

                            # Step 3: download LRC
                            dl_r = req.get(
                                "https://lyrics.kugou.com/download",
                                params={
                                    "ver": 1, "client": "pc",
                                    "id": cand["id"],
                                    "accesskey": cand["accesskey"],
                                    "fmt": "lrc", "charset": "utf8",
                                },
                                timeout=8
                            )
                            if dl_r.ok:
                                content_b64 = dl_r.json().get("content", "")
                                if content_b64:
                                    lrc = base64.b64decode(content_b64).decode("utf-8", errors="ignore")
                                    if lrc.strip():
                                        result = {"source": "Kugou", "synced": lrc, "plain": None}
        except Exception as e:
            print(f"[lyrics] Kugou error: {e}", flush=True)

    # 4. Musixmatch (Word-Sync via RichSync, fallback: Line-Sync)
    if not result and source in ("auto", "musixmatch"):
        try:
            result = _try_musixmatch(title, artist, duration)
        except Exception as e:
            print(f"[lyrics] Musixmatch error: {e}", flush=True)

    # 5. SimpMusic (videoId-only — search endpoint is currently unavailable)
    if not result and source in ("auto", "simp") and video_id:
        try:
            r = req.get(f"https://api-lyrics.simpmusic.org/v1/{video_id}", timeout=8)
            if r.ok:
                d = r.json()
                items = d.get("data", [])
                item = items[0] if isinstance(items, list) and items else None
                if item:
                    synced = item.get("syncedLyrics")
                    plain = item.get("plainLyric")
                    if synced:
                        result = {"source": "SimpMusic", "synced": synced, "plain": None}
                    elif plain:
                        result = {"source": "SimpMusic", "synced": None, "plain": plain}
        except Exception as e:
            print(f"[lyrics] SimpMusic error: {e}", flush=True)

    if not result:
        return jsonify({"source": None, "synced": None, "plain": None})

    # Save to cache
    if _cache_enabled.get("lyrics", True):
        try:
            cache_key = _lyrics_cache_key(title, artist, source)
            cache_path = os.path.join(LYRICS_CACHE_DIR, f"{cache_key}.json")
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
        except Exception:
            pass

    return jsonify(result)

@app.route("/shutdown", methods=["GET", "POST"])
def shutdown():
    """Beendet den Server sauber."""
    import threading, os
    def _shutdown():
        import time
        time.sleep(0.2)
        os._exit(0)
    threading.Thread(target=_shutdown, daemon=True).start()
    return "ok"

@app.route("/status")
def status():
    return jsonify({"ok": True, "message": "Kiyoshi Music Backend laeuft"})

# In-memory LRU cache für Lyrics-Übersetzungen (max 500 Einträge)
_LYRICS_CACHE_MAX = 500
_translation_cache = collections.OrderedDict()
_romaji_cache      = collections.OrderedDict()

def _lru_put(cache, key, value):
    cache[key] = value
    cache.move_to_end(key)
    if len(cache) > _LYRICS_CACHE_MAX:
        cache.popitem(last=False)

# Romaji-Konverter (lazy init)
_kakasi = None
_JP_RE = __import__('re').compile(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uff66-\uff9f]')

def _get_kakasi():
    global _kakasi
    if _kakasi is None:
        import pykakasi
        _kakasi = pykakasi.kakasi()
    return _kakasi

@app.route("/romanize-lyrics", methods=["POST"])
def romanize_lyrics():
    """Konvertiert japanische Lyrics-Zeilen zu Romaji via pykakasi."""
    data = request.get_json()
    lines = data.get("lines", [])

    if not lines:
        return jsonify({"romanizations": []})

    try:
        kks = _get_kakasi()
    except ImportError:
        return jsonify({"error": "pykakasi nicht installiert.", "romanizations": [""] * len(lines)}), 503

    result = []
    for line in lines:
        if not line.strip() or not _JP_RE.search(line):
            result.append("")
            continue
        cache_key = f"romaji:{line}"
        if cache_key in _romaji_cache:
            result.append(_romaji_cache[cache_key])
            continue
        converted = kks.convert(line)
        romaji = " ".join(
            item.get('hepburn') or item.get('orig', '')
            for item in converted
            if (item.get('hepburn') or item.get('orig', '')).strip()
        )
        _lru_put(_romaji_cache, cache_key, romaji)
        result.append(romaji)

    return jsonify({"romanizations": result})

# Google Translate language code mapping (DeepL uppercase → Google lowercase)
_GOOGLE_LANG = {
    "DE": "de", "EN": "en", "FR": "fr", "ES": "es", "IT": "it",
    "PT": "pt", "NL": "nl", "PL": "pl", "RU": "ru",
    "JA": "ja", "KO": "ko", "ZH": "zh-CN",
}

def _google_translate_batch(lines, target_lang):
    """Übersetzt eine Liste von Strings via inoffizielle Google Translate API.
    Nutzt \n als Trennzeichen um mit einem Request auszukommen."""
    gl = _GOOGLE_LANG.get(target_lang, target_lang.lower())
    # Zeilen mit seltener Zeichenfolge verbinden damit Google sie nicht zusammenzieht
    separator = "\n"
    text = separator.join(lines)
    params = {
        "client": "gtx",
        "sl": "auto",
        "tl": gl,
        "dt": "t",
        "q": text,
    }
    resp = requests.get(
        "https://translate.googleapis.com/translate_a/single",
        params=params,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    resp.raise_for_status()
    data = resp.json()
    # data[0] enthält [[übersetzt, original, ...], ...] Chunks
    translated = "".join(chunk[0] for chunk in data[0] if chunk and chunk[0])
    translated_lines = translated.split("\n")
    # Auf gleiche Länge bringen
    while len(translated_lines) < len(lines):
        translated_lines.append("")
    return translated_lines[:len(lines)]

@app.route("/translate-lyrics", methods=["POST"])
def translate_lyrics():
    """Übersetzt Lyrics-Zeilen via Google Translate (kein API-Key nötig)."""
    data = request.get_json()
    lines = data.get("lines", [])
    target_lang = data.get("target_lang", "DE").upper()

    if not lines:
        return jsonify({"translations": []})

    # Leere Zeilen (Pausen/Leerzeilen) direkt durchlassen
    non_empty_indices = [i for i, l in enumerate(lines) if l.strip()]
    non_empty_lines = [lines[i] for i in non_empty_indices]

    if not non_empty_lines:
        return jsonify({"translations": list(lines)})

    cache_key = f"{target_lang}:{hash(tuple(non_empty_lines))}"
    if cache_key in _translation_cache:
        cached = _translation_cache[cache_key]
        result = list(lines)
        for idx, translated in zip(non_empty_indices, cached):
            result[idx] = translated
        return jsonify({"translations": result})

    try:
        translated_lines = _google_translate_batch(non_empty_lines, target_lang)
        _lru_put(_translation_cache, cache_key, translated_lines)
        result = list(lines)
        for idx, translated in zip(non_empty_indices, translated_lines):
            result[idx] = translated
        return jsonify({"translations": result})
    except Exception as e:
        print(f"[Translation] Error: {e}")
        return jsonify({"error": str(e), "translations": list(lines)}), 500

@app.route("/cache/stats")
def cache_stats():
    pl_size, pl_count = _dir_size_and_count(PLAYLIST_CACHE_DIR)
    al_size, al_count = _dir_size_and_count(ALBUM_CACHE_DIR)
    img_size, img_count = _dir_size_and_count(IMG_CACHE_DIR)
    song_size, song_count = _dir_size_and_count(SONG_CACHE_DIR)
    # Count only .json metadata files for accurate song count
    try:
        song_count = len([f for f in os.listdir(SONG_CACHE_DIR) if f.endswith(".json")])
    except Exception:
        song_count = 0
    lyr_size, lyr_count = _dir_size_and_count(LYRICS_CACHE_DIR)
    return jsonify({
        "playlists": {"size": pl_size, "count": pl_count, "enabled": _cache_enabled["playlists"]},
        "albums":    {"size": al_size, "count": al_count, "enabled": _cache_enabled["albums"]},
        "images":    {"size": img_size, "count": img_count, "enabled": _cache_enabled["images"]},
        "songs":     {"size": song_size, "count": song_count, "enabled": _cache_enabled["songs"]},
        "lyrics":    {"size": lyr_size, "count": lyr_count, "enabled": _cache_enabled["lyrics"]},
    })

@app.route("/cache/clear", methods=["POST"])
def cache_clear():
    global _playlist_cache, _download_status
    data = request.get_json() or {}
    category = data.get("category", "all")
    dirs = {"playlists": PLAYLIST_CACHE_DIR, "albums": ALBUM_CACHE_DIR, "images": IMG_CACHE_DIR, "songs": SONG_CACHE_DIR, "lyrics": LYRICS_CACHE_DIR}
    to_clear = [category] if category in dirs else list(dirs.keys())
    for cat in to_clear:
        d = dirs[cat]
        for f in os.listdir(d):
            try:
                os.remove(os.path.join(d, f))
            except Exception:
                pass
        if cat == "playlists":
            _playlist_cache.clear()
        if cat == "songs":
            _download_status = {}
    return jsonify({"ok": True})

@app.route("/cache/settings", methods=["GET", "POST"])
def cache_settings():
    global _cache_enabled
    if request.method == "POST":
        body = request.get_json() or {}
        for k in ("playlists", "albums", "images", "songs", "lyrics"):
            if k in body:
                _cache_enabled[k] = bool(body[k])
        return jsonify({"ok": True})
    return jsonify(_cache_enabled)

@app.route("/liked")
def liked_songs():
    try:
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                rows = db.execute(
                    "SELECT video_id, title, artists, album, thumbnail, duration FROM liked_songs ORDER BY liked_at DESC"
                ).fetchall()
            tracks = [{"videoId": r[0], "title": r[1], "artists": r[2], "album": r[3],
                       "thumbnail": r[4], "duration": r[5]} for r in rows]
            return jsonify({"tracks": tracks})
        limit = request.args.get("limit", None, type=int)
        songs = get_ytmusic().get_liked_songs(limit=limit)
        tracks = []
        for t in songs.get("tracks", []):
            artist_list = t.get("artists", [])
            artists = ", ".join(a["name"] for a in artist_list)
            artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
            album = t.get("album", {})
            thumbs = t.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            tracks.append({
                "videoId": t.get("videoId", ""),
                "title": t.get("title", ""),
                "artists": artists,
                "artistBrowseId": artist_browse_id,
                "album": album.get("name", "") if album else "",
                "albumBrowseId": (album.get("id") or "") if album else "",
                "duration": t.get("duration", ""),
                "thumbnail": thumbnail,
                "isExplicit": bool(t.get("isExplicit", False)),
            })
        return jsonify({"tracks": tracks})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _ydl_extract_url(video_id, fmt, skip_download=True, extra_opts=None, skip_auth=False):
    """Run yt-dlp extraction with the given format string. Returns info dict."""
    import yt_dlp
    ydl_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
        "skip_download": skip_download,
    }
    if extra_opts:
        ydl_opts.update(extra_opts)
    if not skip_auth:
        _apply_ydl_auth(ydl_opts)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(
            f"https://music.youtube.com/watch?v={video_id}",
            download=False
        )

def _ydl_pick_any_audio(video_id, extra_opts=None, skip_auth=False):
    """Last-resort: fetch all formats without a selector and pick manually."""
    import yt_dlp
    ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    if extra_opts:
        ydl_opts.update(extra_opts)
    if not skip_auth:
        _apply_ydl_auth(ydl_opts)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(
            f"https://music.youtube.com/watch?v={video_id}",
            download=False
        )
    fmts = info.get("formats") or []
    _logging.info(f"[stream] {video_id} available formats: {[f.get('format_id') for f in fmts]}")
    audio_only = [f for f in fmts if f.get("acodec") != "none" and f.get("vcodec") == "none" and f.get("url")]
    has_audio  = [f for f in fmts if f.get("acodec") != "none" and f.get("url")]
    candidates = audio_only or has_audio or [f for f in fmts if f.get("url")]
    if candidates:
        return candidates[-1]["url"]
    return info.get("url")

# Each entry: (format_string, extra_ydl_opts, skip_auth)
# Anonymous (skip_auth=True) attempts come FIRST: the default web client
# requires PO tokens when cookies are present, causing "Requested format is
# not available" even for ordinary tracks.  Without cookies, YouTube serves
# standard stream URLs and format extraction works reliably.
# Authenticated fallbacks are kept at the end for premium / restricted content.
_WEB_MUSIC_OPTS = {"extractor_args": {"youtube": {"player_client": ["web_music"]}}}
_ANDROID_OPTS   = {"extractor_args": {"youtube": {"player_client": ["android_music"], "player_skip": ["js"]}}}
_IOS_OPTS       = {"extractor_args": {"youtube": {"player_client": ["ios"],           "player_skip": ["js"]}}}
_M4A_FMT = "bestaudio[ext=m4a]/bestaudio[acodec=aac]"

_STREAM_ATTEMPTS = [
    # ── anonymous first (no PO-token issues), m4a/AAC only ───────────────────
    # symphonia 0.5 has no Opus decoder — WebM/Opus files would skip immediately
    (_M4A_FMT, None,            True),
    (_M4A_FMT, _WEB_MUSIC_OPTS, True),   # YTMusic exclusives
    (_M4A_FMT, _ANDROID_OPTS,   True),
    (_M4A_FMT, _IOS_OPTS,       True),
    # ── authenticated fallback (premium / geo-restricted content) ────────────
    (_M4A_FMT, None,            False),
    (_M4A_FMT, _WEB_MUSIC_OPTS, False),
    (_M4A_FMT, _ANDROID_OPTS,   False),
]

def _stream_url_from_info(info):
    url = info.get("url")
    if not url and info.get("formats"):
        audio_fmts = [f for f in info["formats"]
                      if f.get("acodec") != "none" and f.get("vcodec") == "none"]
        chosen = audio_fmts[-1] if audio_fmts else info["formats"][-1]
        url = chosen.get("url")
    return url

def _is_hard_error(err_str):
    # Only Music Premium is a guaranteed dead end regardless of client.
    # "Video unavailable" can still succeed with web_music/android_music
    # for YouTube Music exclusive content.
    return "Music Premium" in err_str

def _is_unavailable(err_str):
    return any(k in err_str for k in ("Video unavailable", "This video is not available"))

@app.route("/stream/<video_id>")
def stream_url(video_id):
    last_err = None
    for fmt, extra, no_auth in _STREAM_ATTEMPTS:
        try:
            info = _ydl_extract_url(video_id, fmt, extra_opts=extra, skip_auth=no_auth)
            url = _stream_url_from_info(info)
            if url:
                return jsonify({"url": url})
        except Exception as e:
            last_err = e
            err_str = str(e)
            if _is_hard_error(err_str):
                break
            _logging.warning(f"[stream] {video_id} fmt={fmt} auth={not no_auth} failed: {e}")
    # Brute-force: no format selector, pick manually — with and without auth
    _hard_stop = False
    for no_auth in (False, True):
        if _hard_stop:
            break
        for extra in (None, _ANDROID_OPTS, _IOS_OPTS):
            try:
                url = _ydl_pick_any_audio(video_id, extra_opts=extra, skip_auth=no_auth)
                if url:
                    _logging.info(f"[stream] {video_id} recovered via brute-force (auth={not no_auth})")
                    return jsonify({"url": url})
            except Exception as e:
                last_err = e
                if _is_hard_error(str(e)) or _is_unavailable(str(e)):
                    _hard_stop = True
                    break
                _logging.warning(f"[stream] {video_id} brute-force auth={not no_auth} failed: {e}")
    err_str = str(last_err) if last_err else "No URL found"
    premium = "Music Premium" in err_str
    unavailable = _is_unavailable(err_str)
    _logging.error(f"[stream] {video_id}: {type(last_err).__name__}: {err_str}")
    return jsonify({"error": err_str, "premium_only": premium, "unavailable": unavailable}), 500


@app.route("/stream-prepare/<video_id>")
def stream_prepare(video_id):
    """Download audio via yt-dlp to a temp file and return the local path.
    Rust reads from disk — no HTTP proxy overhead, no truncation."""
    import tempfile, glob as _glob
    cache_dir = os.path.join(tempfile.gettempdir(), "kiyoshi-audio")
    os.makedirs(cache_dir, exist_ok=True)

    # Check if already downloaded (skip WebM — symphonia has no Opus decoder)
    _PLAYABLE_EXTS = {".m4a", ".mp4", ".mp3", ".ogg", ".flac", ".wav"}
    existing = _glob.glob(os.path.join(cache_dir, f"{video_id}.*"))
    for ex in existing:
        ext = os.path.splitext(ex)[1].lower()
        if ext in _PLAYABLE_EXTS and os.path.getsize(ex) > 0:
            print(f"[stream-prepare] Cache hit: {ex}", flush=True)
            return jsonify({"path": ex})
        elif ext not in _PLAYABLE_EXTS and os.path.exists(ex):
            print(f"[stream-prepare] Removing unplayable cache file: {ex}", flush=True)
            try:
                os.remove(ex)
            except OSError:
                pass

    import yt_dlp
    outtmpl = os.path.join(cache_dir, "%(id)s.%(ext)s")
    last_err = None
    for fmt, extra, no_auth in _STREAM_ATTEMPTS:
        try:
            ydl_opts = {
                "format": fmt,
                "outtmpl": outtmpl,
                "quiet": True,
                "no_warnings": True,
            }
            if extra:
                ydl_opts.update(extra)
            if not no_auth:
                _apply_ydl_auth(ydl_opts)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(
                    f"https://music.youtube.com/watch?v={video_id}",
                    download=True
                )
                path = ydl.prepare_filename(info)
            _logging.info(f"[stream-prepare] downloaded {video_id}: {os.path.getsize(path)} bytes")
            return jsonify({"path": path})
        except Exception as e:
            last_err = e
            err_str = str(e)
            if _is_hard_error(err_str):
                break
            _logging.warning(f"[stream-prepare] {video_id} fmt={fmt} auth={not no_auth} failed: {e}")
    err_str = str(last_err) if last_err else "Download failed"
    premium = "Music Premium" in err_str
    unavailable = _is_unavailable(err_str)
    _logging.error(f"[stream-prepare] {video_id}: {type(last_err).__name__}: {err_str}")
    return jsonify({"error": err_str, "premium_only": premium, "unavailable": unavailable}), 500


@app.route("/library/playlists")
def library_playlists():
    try:
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                rows = db.execute(
                    "SELECT playlist_id, title, description, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id=p.playlist_id) FROM playlists p ORDER BY updated_at DESC"
                ).fetchall()
            result = [{"playlistId": r[0], "title": r[1], "description": r[2], "count": str(r[3]), "thumbnail": ""} for r in rows]
            return jsonify({"playlists": result})
        playlists = get_ytmusic().get_library_playlists(limit=50)
        result = []
        for p in playlists:
            thumbs = p.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            result.append({
                "playlistId": p.get("playlistId", ""),
                "title": p.get("title", ""),
                "count": p.get("count", ""),
                "thumbnail": thumbnail,
            })
        return jsonify({"playlists": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/create", methods=["POST"])
def create_playlist():
    try:
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        if not title:
            return jsonify({"error": "Title is required"}), 400
        description = data.get("description", "")
        privacy = data.get("privacyStatus", "PRIVATE")
        if is_local_profile(_current_profile):
            playlist_id = str(uuid.uuid4())
            now = int(time.time())
            with local_db(_current_profile) as db:
                db.execute(
                    "INSERT INTO playlists (playlist_id, title, description, privacy, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    (playlist_id, title, description, privacy, now, now)
                )
                db.commit()
            return jsonify({"ok": True, "playlistId": playlist_id})
        video_ids = data.get("videoIds")
        result = get_ytmusic().create_playlist(title, description, privacy_status=privacy, video_ids=video_ids)
        return jsonify({"ok": True, "playlistId": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>/add", methods=["POST"])
def playlist_add_tracks(playlist_id):
    try:
        data = request.get_json() or {}
        video_ids = data.get("videoIds", [])
        if not video_ids:
            return jsonify({"error": "videoIds required"}), 400
        if is_local_profile(_current_profile):
            tracks_meta = {t["videoId"]: t for t in data.get("tracks", []) if "videoId" in t}
            now = int(time.time())
            with local_db(_current_profile) as db:
                max_pos = db.execute("SELECT COALESCE(MAX(position),0) FROM playlist_tracks WHERE playlist_id=?", (playlist_id,)).fetchone()[0]
                for i, vid in enumerate(video_ids):
                    meta = tracks_meta.get(vid, {})
                    svid = str(uuid.uuid4())
                    db.execute(
                        "INSERT INTO playlist_tracks (playlist_id, video_id, title, artists, album, thumbnail, duration, set_video_id, position, added_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (playlist_id, vid, meta.get("title",""), meta.get("artists",""),
                         meta.get("album",""), meta.get("thumbnail",""), meta.get("duration",""),
                         svid, max_pos + i + 1, now)
                    )
                db.execute("UPDATE playlists SET updated_at=? WHERE playlist_id=?", (now, playlist_id))
                db.commit()
            return jsonify({"ok": True})
        get_ytmusic().add_playlist_items(playlist_id, video_ids)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>/remove", methods=["POST"])
def playlist_remove_tracks(playlist_id):
    try:
        data = request.get_json() or {}
        videos = data.get("videos", [])
        if not videos:
            return jsonify({"error": "videos required"}), 400
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                for v in videos:
                    svid = v.get("setVideoId")
                    if svid:
                        db.execute("DELETE FROM playlist_tracks WHERE playlist_id=? AND set_video_id=?", (playlist_id, svid))
                    else:
                        db.execute("DELETE FROM playlist_tracks WHERE playlist_id=? AND video_id=?", (playlist_id, v.get("videoId","")))
                db.execute("UPDATE playlists SET updated_at=? WHERE playlist_id=?", (int(time.time()), playlist_id))
                db.commit()
            return jsonify({"ok": True})
        get_ytmusic().remove_playlist_items(playlist_id, videos)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>/edit", methods=["POST"])
def playlist_edit(playlist_id):
    try:
        data = request.get_json() or {}
        title = data.get("title")
        description = data.get("description")
        privacy = data.get("privacyStatus")
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                if title:
                    db.execute("UPDATE playlists SET title=?, updated_at=? WHERE playlist_id=?", (title, int(time.time()), playlist_id))
                if description is not None:
                    db.execute("UPDATE playlists SET description=? WHERE playlist_id=?", (description, playlist_id))
                if privacy:
                    db.execute("UPDATE playlists SET privacy=? WHERE playlist_id=?", (privacy, playlist_id))
                db.commit()
            return jsonify({"ok": True})
        get_ytmusic().edit_playlist(playlist_id, title=title, description=description, privacyStatus=privacy)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id):
    try:
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                db.execute("DELETE FROM playlist_tracks WHERE playlist_id=?", (playlist_id,))
                db.execute("DELETE FROM playlists WHERE playlist_id=?", (playlist_id,))
                db.commit()
            return jsonify({"ok": True})
        get_ytmusic().delete_playlist(playlist_id)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/library/albums")
def library_albums():
    try:
        if is_local_profile(_current_profile):
            return jsonify({"albums": []})
        albums = get_ytmusic().get_library_albums(limit=50)
        result = []
        for a in albums:
            thumbs = a.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            artists = ", ".join(x["name"] for x in a.get("artists", []))
            result.append({
                "browseId": a.get("browseId", ""),
                "title": a.get("title", ""),
                "artists": artists,
                "year": a.get("year", ""),
                "thumbnail": thumbnail,
            })
        return jsonify({"albums": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/library/artists")
def library_artists():
    try:
        if is_local_profile(_current_profile):
            return jsonify({"artists": []})
        artists = get_ytmusic().get_library_artists(limit=50)
        result = []
        for a in artists:
            thumbs = a.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            result.append({
                "browseId": a.get("browseId", ""),
                "artist": a.get("artist", ""),
                "songs": a.get("songs", ""),
                "thumbnail": thumbnail,
            })
        return jsonify({"artists": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>/stream")
def stream_playlist(playlist_id):
    import json
    from flask import Response, stream_with_context

    force_refresh = request.args.get("refresh", "0") == "1"

    def generate():
        try:
            CHUNK = 200

            # Local profile: serve from SQLite
            if is_local_profile(_current_profile):
                with local_db(_current_profile) as db:
                    if playlist_id == "LM":
                        rows = db.execute(
                            "SELECT video_id, title, artists, album, thumbnail, duration FROM liked_songs ORDER BY liked_at DESC"
                        ).fetchall()
                        tracks = [{"videoId": r[0], "setVideoId": r[0], "title": r[1], "artists": r[2],
                                   "album": r[3], "thumbnail": r[4], "duration": r[5]} for r in rows]
                        pl_title = "Gelikte Songs"
                    else:
                        pl_row = db.execute("SELECT title FROM playlists WHERE playlist_id=?", (playlist_id,)).fetchone()
                        pl_title = pl_row[0] if pl_row else playlist_id
                        rows = db.execute(
                            "SELECT video_id, set_video_id, title, artists, album, thumbnail, duration FROM playlist_tracks WHERE playlist_id=? ORDER BY position ASC",
                            (playlist_id,)
                        ).fetchall()
                        tracks = [{"videoId": r[0], "setVideoId": r[1], "title": r[2], "artists": r[3],
                                   "album": r[4], "thumbnail": r[5], "duration": r[6]} for r in rows]
                yield f"data: {json.dumps({'type':'header','title':pl_title,'thumbnail':'','total':len(tracks),'cached':True})}\n\n"
                for i in range(0, len(tracks), CHUNK):
                    yield f"data: {json.dumps({'type':'tracks','tracks':tracks[i:i+CHUNK]})}\n\n"
                yield f"data: {json.dumps({'type':'done'})}\n\n"
                return

            def fmt(t):
                artist_list = t.get("artists", [])
                artists = ", ".join(a["name"] for a in artist_list)
                artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
                thumbs = t.get("thumbnails", [])
                thumb = thumbs[-1].get("url", "") if thumbs else ""
                album = t.get("album") or {}
                return {
                    "videoId": t.get("videoId", ""),
                    "setVideoId": t.get("setVideoId", ""),
                    "title": t.get("title", ""),
                    "artists": artists,
                    "artistBrowseId": artist_browse_id,
                    "album": album.get("name", ""),
                    "albumBrowseId": (album.get("id") or ""),
                    "duration": t.get("duration", ""),
                    "thumbnail": thumb,
                    "isExplicit": bool(t.get("isExplicit", False)),
                }

            def send(obj):
                return f"data: {json.dumps(obj)}\n\n"

            def serve_cached(data):
                tracks = data["tracks"]
                yield send({"type": "header", "title": data["title"], "thumbnail": data["thumbnail"], "total": len(tracks), "cached": True})
                for i in range(0, len(tracks), CHUNK):
                    yield send({"type": "tracks", "tracks": tracks[i:i+CHUNK]})
                yield send({"type": "done"})

            if not force_refresh and _cache_enabled["playlists"]:
                # 1. In-memory cache (fastest) — skip if missing isExplicit field
                if playlist_id in _playlist_cache:
                    mem = _playlist_cache[playlist_id]
                    mem_tracks = mem.get("tracks", [])
                    if mem_tracks and "isExplicit" not in mem_tracks[0]:
                        del _playlist_cache[playlist_id]
                    else:
                        yield from serve_cached(mem)
                        return
                # 2. Disk cache
                disk = _load_playlist_disk(playlist_id)
                if disk:
                    _playlist_cache_put(playlist_id, disk)  # warm in-memory cache too
                    yield from serve_cached(disk)
                    return

            if playlist_id == "LM":
                yield send({"type": "loading", "message": "Liked Songs werden abgerufen\u2026", "progress": 0})
                songs = get_ytmusic().get_liked_songs(limit=None)
                all_tracks = [fmt(t) for t in songs.get("tracks", []) if t.get("videoId")]
                total = len(all_tracks)
                yield send({"type": "header", "title": "Liked Songs", "thumbnail": "", "total": total})
                for i in range(0, total, CHUNK):
                    pct = min(100, round((i + CHUNK) / total * 100)) if total else 100
                    yield send({"type": "progress", "progress": pct})
                    yield send({"type": "tracks", "tracks": all_tracks[i:i+CHUNK]})
                data = {"title": "Liked Songs", "thumbnail": "", "tracks": all_tracks}
                if _cache_enabled["playlists"]:
                    _playlist_cache_put(playlist_id, data)
                    _save_playlist_disk(playlist_id, data)
                yield send({"type": "done"})
                return

            yield send({"type": "loading", "message": "Playlist wird abgerufen\u2026", "progress": 0})
            playlist = get_ytmusic().get_playlist(playlist_id, limit=None)
            thumbs = playlist.get("thumbnails") or []
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            all_tracks = [fmt(t) for t in playlist.get("tracks", []) if t.get("videoId")]
            total = len(all_tracks)

            yield send({"type": "header", "title": playlist.get("title", ""), "thumbnail": thumbnail, "total": total})
            for i in range(0, total, CHUNK):
                pct = min(100, round((i + CHUNK) / total * 100)) if total else 100
                yield send({"type": "progress", "progress": pct})
                yield send({"type": "tracks", "tracks": all_tracks[i:i+CHUNK]})
            data = {"title": playlist.get("title", ""), "thumbnail": thumbnail, "tracks": all_tracks}
            if _cache_enabled["playlists"]:
                _playlist_cache_put(playlist_id, data)
                _save_playlist_disk(playlist_id, data)
            yield send({"type": "done"})

        except Exception as e:
            yield send({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Transfer-Encoding": "chunked"}
    )

@app.route("/playlist/<playlist_id>")
def get_playlist(playlist_id):
    try:
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                if playlist_id == "LM":
                    rows = db.execute(
                        "SELECT video_id, title, artists, album, thumbnail, duration FROM liked_songs ORDER BY liked_at DESC"
                    ).fetchall()
                    tracks = [{"videoId": r[0], "setVideoId": r[0], "title": r[1], "artists": r[2],
                               "album": r[3], "thumbnail": r[4], "duration": r[5]} for r in rows]
                    return jsonify({"title": "Gelikte Songs", "thumbnail": "", "tracks": tracks})
                pl_row = db.execute("SELECT title FROM playlists WHERE playlist_id=?", (playlist_id,)).fetchone()
                pl_title = pl_row[0] if pl_row else playlist_id
                rows = db.execute(
                    "SELECT video_id, set_video_id, title, artists, album, thumbnail, duration FROM playlist_tracks WHERE playlist_id=? ORDER BY position ASC",
                    (playlist_id,)
                ).fetchall()
            tracks = [{"videoId": r[0], "setVideoId": r[1], "title": r[2], "artists": r[3],
                       "album": r[4], "thumbnail": r[5], "duration": r[6]} for r in rows]
            return jsonify({"title": pl_title, "thumbnail": "", "tracks": tracks})

        # "LM" is the special Liked Songs playlist
        if playlist_id == "LM":
            songs = get_ytmusic().get_liked_songs(limit=None)
            tracks = []
            for t in songs.get("tracks", []):
                if not t.get("videoId"):
                    continue
                artist_list = t.get("artists", [])
                artists = ", ".join(a["name"] for a in artist_list)
                artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
                thumbs = t.get("thumbnails", [])
                thumbnail = thumbs[-1].get("url", "") if thumbs else ""
                album = t.get("album") or {}
                tracks.append({
                    "videoId": t.get("videoId", ""),
                    "setVideoId": t.get("setVideoId", ""),
                    "title": t.get("title", ""),
                    "artists": artists,
                    "artistBrowseId": artist_browse_id,
                    "album": album.get("name", ""),
                    "albumBrowseId": (album.get("id") or ""),
                    "duration": t.get("duration", ""),
                    "thumbnail": thumbnail,
                    "isExplicit": bool(t.get("isExplicit", False)),
                })
            return jsonify({"title": "Liked Songs", "thumbnail": "", "tracks": tracks})

        playlist = get_ytmusic().get_playlist(playlist_id, limit=None)
        tracks = []
        for t in playlist.get("tracks", []):
            if not t.get("videoId"):
                continue
            artist_list = t.get("artists", [])
            artists = ", ".join(a["name"] for a in artist_list)
            artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
            thumbs = t.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            album = t.get("album") or {}
            tracks.append({
                "videoId": t.get("videoId", ""),
                "setVideoId": t.get("setVideoId", ""),
                "title": t.get("title", ""),
                "artists": artists,
                "artistBrowseId": artist_browse_id,
                "album": album.get("name", ""),
                "albumBrowseId": (album.get("id") or ""),
                "duration": t.get("duration", ""),
                "thumbnail": thumbnail,
                "isExplicit": bool(t.get("isExplicit", False)),
            })
        return jsonify({
            "title": playlist.get("title", ""),
            "thumbnail": (playlist.get("thumbnails") or [{}])[-1].get("url", ""),
            "tracks": tracks,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/album/<browse_id>")
def get_album(browse_id):
    try:
        force_refresh = request.args.get("refresh", "0") == "1"
        if not force_refresh and _cache_enabled["albums"]:
            cached = _load_album_disk(browse_id)
            if cached:
                return jsonify(cached)

        album = get_ytmusic().get_album(browse_id)
        tracks = []
        album_artists = album.get("artists", [])
        album_artist_name = ", ".join(a["name"] for a in album_artists)
        album_artist_browse_id = album_artists[0].get("id", "") if album_artists else ""
        for t in album.get("tracks", []):
            if not t.get("videoId"):
                continue
            track_artists = t.get("artists", [])
            artists = ", ".join(a["name"] for a in track_artists) or album_artist_name
            artist_browse_id = track_artists[0].get("id", "") if track_artists else album_artist_browse_id
            thumbs = album.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            tracks.append({
                "videoId": t.get("videoId", ""),
                "title": t.get("title", ""),
                "artists": artists,
                "artistBrowseId": artist_browse_id,
                "album": album.get("title", ""),
                "duration": t.get("duration", ""),
                "thumbnail": thumbnail,
                "isExplicit": bool(t.get("isExplicit", False)),
            })
        thumbs = album.get("thumbnails", [])
        result = {
            "title": album.get("title", ""),
            "artists": album_artist_name,
            "artistBrowseId": album_artist_browse_id,
            "year": album.get("year", ""),
            "thumbnail": thumbs[-1].get("url", "") if thumbs else "",
            "tracks": tracks,
        }
        if _cache_enabled["albums"]:
            _save_album_disk(browse_id, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/artist/<browse_id>")
def get_artist(browse_id):
    try:
        artist = get_ytmusic().get_artist(browse_id)

        # Top songs
        tracks = []
        for t in (artist.get("songs", {}).get("results", []))[:20]:
            if not t.get("videoId"):
                continue
            thumbs = t.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""
            # duration may be a pre-formatted string ("3:45") or absent;
            # fall back to duration_seconds if available
            duration = t.get("duration", "")
            if not duration:
                secs = t.get("duration_seconds") or t.get("durationSeconds") or 0
                if secs:
                    m, s = divmod(int(secs), 60)
                    duration = f"{m}:{s:02d}"
            tracks.append({
                "videoId": t.get("videoId", ""),
                "title": t.get("title", ""),
                "artists": artist.get("name", ""),
                "artistBrowseId": browse_id,
                "album": (t.get("album") or {}).get("name", ""),
                "albumBrowseId": ((t.get("album") or {}).get("id") or ""),
                "duration": duration,
                "thumbnail": thumbnail,
                "isExplicit": bool(t.get("isExplicit", False)),
            })

        # Albums
        albums = []
        for a in (artist.get("albums", {}).get("results", [])):
            thumbs = a.get("thumbnails", [])
            albums.append({
                "browseId": a.get("browseId", ""),
                "title": a.get("title", ""),
                "year": a.get("year", ""),
                "thumbnail": thumbs[-1].get("url", "") if thumbs else "",
            })

        # Singles
        singles = []
        for s in (artist.get("singles", {}).get("results", [])):
            thumbs = s.get("thumbnails", [])
            singles.append({
                "browseId": s.get("browseId", ""),
                "title": s.get("title", ""),
                "year": s.get("year", ""),
                "thumbnail": thumbs[-1].get("url", "") if thumbs else "",
            })

        thumbs = artist.get("thumbnails", [])
        return jsonify({
            "name":          artist.get("name", ""),
            "thumbnail":     thumbs[-1].get("url", "") if thumbs else "",
            "description":   artist.get("description", "") or "",
            "subscribers":   artist.get("subscribers", "") or "",
            "songsBrowseId": (lambda b: b[2:] if b.startswith("VL") else b)(artist.get("songs", {}).get("browseId", "") or ""),
            "tracks":  tracks,
            "albums":  albums,
            "singles": singles,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/search")
def search():
    try:
        query = request.args.get("q", "")
        filter_type = request.args.get("filter", "songs")
        if not query:
            return jsonify({"results": []})

        results = get_ytmusic().search(query, filter=filter_type, limit=20)
        items = []

        for t in results:
            thumbs = t.get("thumbnails", [])
            thumbnail = thumbs[-1].get("url", "") if thumbs else ""

            if filter_type == "songs":
                artist_list = t.get("artists", [])
                artists = ", ".join(a["name"] for a in artist_list)
                artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
                album = t.get("album") or {}
                items.append({
                    "type": "song",
                    "videoId": t.get("videoId", ""),
                    "title": t.get("title", ""),
                    "artists": artists,
                    "artistBrowseId": artist_browse_id,
                    "album": album.get("name", ""),
                    "albumBrowseId": (album.get("id") or ""),
                    "duration": t.get("duration", ""),
                    "thumbnail": thumbnail,
                    "isExplicit": bool(t.get("isExplicit", False)),
                })
            elif filter_type == "artists":
                items.append({
                    "type": "artist",
                    "browseId": t.get("browseId", ""),
                    "title": t.get("artist", "") or t.get("title", ""),
                    "subtitle": t.get("subscribers", ""),
                    "thumbnail": thumbnail,
                })
            elif filter_type == "albums":
                artist_list = t.get("artists", [])
                artists = ", ".join(a["name"] for a in artist_list)
                items.append({
                    "type": "album",
                    "browseId": t.get("browseId", ""),
                    "title": t.get("title", ""),
                    "artists": artists,
                    "year": t.get("year", ""),
                    "thumbnail": thumbnail,
                })

        return jsonify({"results": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/home")
def get_home():
    try:
        home = get_ytmusic().get_home(limit=8)
        sections = []
        for section in home:
            title = section.get("title", "")
            contents = section.get("contents", [])
            items = []
            for item in contents:
                # Song / video
                if item.get("videoId"):
                    artist_list = item.get("artists", [])
                    artists = ", ".join(a["name"] for a in artist_list)
                    artist_browse_id = (artist_list[0].get("id") or "") if artist_list else ""
                    album = item.get("album") or {}
                    thumbs = item.get("thumbnails", [])
                    thumb = thumbs[-1].get("url", "") if thumbs else ""
                    items.append({
                        "type": "song",
                        "videoId": item.get("videoId", ""),
                        "title": item.get("title", ""),
                        "artists": artists,
                        "artistBrowseId": artist_browse_id,
                        "album": album.get("name", ""),
                        "albumBrowseId": (album.get("id") or ""),
                        "duration": item.get("duration", ""),
                        "thumbnail": thumb,
                        "isExplicit": bool(item.get("isExplicit", False)),
                    })
                # Playlist
                elif item.get("playlistId"):
                    thumbs = item.get("thumbnails", [])
                    thumb = thumbs[-1].get("url", "") if thumbs else ""
                    items.append({
                        "type": "playlist",
                        "playlistId": item.get("playlistId", ""),
                        "title": item.get("title", ""),
                        "subtitle": item.get("description", "") or ", ".join(
                            a["name"] for a in item.get("artists", [])
                        ),
                        "thumbnail": thumb,
                    })
                # Album or Artist (YouTube channel IDs start with "UC")
                elif item.get("browseId"):
                    browse_id = item.get("browseId", "")
                    is_artist = browse_id.startswith("UC")
                    item_type = "artist" if is_artist else "album"
                    thumbs = item.get("thumbnails", [])
                    thumb = thumbs[-1].get("url", "") if thumbs else ""
                    artists = ", ".join(a["name"] for a in item.get("artists", []))
                    items.append({
                        "type": item_type,
                        "browseId": browse_id,
                        "title": item.get("title", ""),
                        "subtitle": artists or item.get("year", ""),
                        "thumbnail": thumb,
                    })
            if items:
                sections.append({"title": title, "items": items})
        return jsonify({"sections": sections})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/mood/categories")
def get_mood_categories():
    try:
        cats = get_ytmusic().get_mood_categories()
        chips = []
        seen_params = set()
        for section_title, items in cats.items():
            # Only include moods & moments, skip everything else
            if "mood" not in section_title.lower() and "moment" not in section_title.lower():
                continue
            for item in items:
                params = item.get("params", "")
                if params in seen_params:
                    continue
                seen_params.add(params)
                chips.append({
                    "title": item.get("title", ""),
                    "params": params,
                })
        return jsonify(chips)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/mood/playlists")
def get_mood_playlists():
    try:
        params = request.args.get("params", "")
        if not params:
            return jsonify({"error": "params required"}), 400
        playlists = get_ytmusic().get_mood_playlists(params)
        result = []
        for pl in playlists:
            thumbs = pl.get("thumbnails", [])
            t = thumbs[-1].get("url", "") if thumbs else ""
            artists = ", ".join(a["name"] for a in pl.get("artists", []))
            result.append({
                "playlistId": pl.get("playlistId", ""),
                "title": pl.get("title", ""),
                "subtitle": artists or pl.get("description", ""),
                "thumbnail": t,
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/imgproxy")
def img_proxy():
    """Proxy YouTube thumbnail images with persistent disk cache."""
    import hashlib, urllib.request
    from flask import Response

    url = request.args.get("url", "")
    if not url:
        return "", 400

    # Derive a stable filename from the URL
    url_hash = hashlib.sha1(url.encode()).hexdigest()
    # Detect extension from URL (default jpeg)
    ext = "jpg"
    for candidate in ("webp", "png", "gif"):
        if candidate in url.lower():
            ext = candidate
            break
    cache_path = os.path.join(IMG_CACHE_DIR, f"{url_hash}.{ext}")

    # Serve from disk if cached and fresh
    if _cache_enabled["images"] and os.path.exists(cache_path):
        age = time.time() - os.path.getmtime(cache_path)
        if age < IMG_CACHE_TTL:
            content_type = "image/webp" if ext == "webp" else f"image/{ext}"
            with open(cache_path, "rb") as f:
                data = f.read()
            resp = Response(data, content_type=content_type)
            resp.headers["Cache-Control"] = "public, max-age=604800"
            resp.headers["X-Cache"] = "HIT"
            return resp

    # Fetch from CDN (omit YouTube-specific Referer for non-ytimg domains)
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        if "ytimg.com" in url or "yt3.ggpht.com" in url or "youtube.com" in url:
            headers["Referer"] = "https://music.youtube.com/"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
            content_type = r.headers.get("Content-Type", "image/jpeg")
        # Write to disk cache
        if _cache_enabled["images"]:
            with open(cache_path, "wb") as f:
                f.write(data)
        resp = Response(data, content_type=content_type)
        resp.headers["Cache-Control"] = "public, max-age=604800"
        resp.headers["X-Cache"] = "MISS"
        return resp
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/like/<video_id>", methods=["POST"])
def like_song(video_id):
    try:
        data = request.get_json() or {}
        rating = data.get("rating", "LIKE")
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                if rating == "LIKE":
                    db.execute(
                        "INSERT OR REPLACE INTO liked_songs (video_id, title, artists, album, thumbnail, duration, liked_at) VALUES (?,?,?,?,?,?,?)",
                        (video_id, data.get("title",""), data.get("artists",""),
                         data.get("album",""), data.get("thumbnail",""),
                         data.get("duration",""), int(time.time()))
                    )
                else:
                    db.execute("DELETE FROM liked_songs WHERE video_id=?", (video_id,))
                db.commit()
            return jsonify({"ok": True, "rating": rating})
        get_ytmusic().rate_song(video_id, rating)
        return jsonify({"ok": True, "rating": rating})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/liked/ids")
def liked_ids():
    try:
        if is_local_profile(_current_profile):
            with local_db(_current_profile) as db:
                ids = [r[0] for r in db.execute("SELECT video_id FROM liked_songs").fetchall()]
            return jsonify({"ids": ids})
        songs = get_ytmusic().get_liked_songs(limit=None)
        ids = [t.get("videoId") for t in songs.get("tracks", []) if t.get("videoId")]
        return jsonify({"ids": ids})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/song/info/<video_id>")
def song_info(video_id):
    """Return albumBrowseId and artistBrowseId for a given video ID."""
    try:
        data = get_ytmusic().get_song(video_id)
        details = data.get("videoDetails", {})
        # Artist browse ID from microformat or videoDetails
        mf = data.get("microformat", {}).get("microformatDataRenderer", {})
        artist_id = ""
        # Try to get from related endpoints
        try:
            result = get_ytmusic().search(
                f"{details.get('title', '')} {details.get('author', '')}",
                filter="songs", limit=1
            )
            if result:
                hit = result[0]
                al = hit.get("artists", [])
                artist_id = (al[0].get("id") or "") if al else ""
                album = hit.get("album") or {}
                album_id = (album.get("id") or "")
            else:
                album_id = ""
        except Exception:
            album_id = ""
        return jsonify({
            "artistBrowseId": artist_id,
            "albumBrowseId": album_id,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/song/stats/<video_id>")
def song_stats(video_id):
    try:
        r = requests.get(
            f"https://returnyoutubedislikeapi.com/votes?videoId={video_id}",
            timeout=5,
            headers={"Accept": "application/json"}
        )
        if r.status_code == 200:
            d = r.json()
            def fmt_num(n):
                if n is None: return None
                n = int(n)
                if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
                if n >= 1_000: return f"{n/1_000:.1f}K"
                return str(n)
            return jsonify({
                "views":    fmt_num(d.get("viewCount")),
                "likes":    fmt_num(d.get("likes")),
                "dislikes": fmt_num(d.get("dislikes")),
                "viewsRaw":    d.get("viewCount"),
                "likesRaw":    d.get("likes"),
                "dislikesRaw": d.get("dislikes"),
            })
        return jsonify({"error": "stats unavailable"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── Song Cache / Offline Playback ──────────────────────────────────────────

def _song_audio_path(video_id):
    """Return the path to the cached audio file (.opus or .m4a)."""
    safe = video_id.replace("/", "_").replace("\\", "_")
    for ext in (".opus", ".m4a", ".webm", ".mp3"):
        p = os.path.join(SONG_CACHE_DIR, safe + ext)
        if os.path.exists(p):
            return p
    return None

def _song_meta_path(video_id):
    safe = video_id.replace("/", "_").replace("\\", "_")
    return os.path.join(SONG_CACHE_DIR, safe + ".json")

def _download_song_bg(video_id, meta):
    """Background download via yt-dlp."""
    global _download_status, _download_queue
    try:
        import yt_dlp
        safe = video_id.replace("/", "_").replace("\\", "_")
        output_tpl = os.path.join(SONG_CACHE_DIR, safe + ".%(ext)s")

        def progress_hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes", 0)
                if total > 0 and video_id in _download_queue:
                    _download_queue[video_id]["progress"] = round(downloaded / total, 3)

        last_dl_err = None
        for fmt, extra, no_auth in _STREAM_ATTEMPTS:
            try:
                ydl_opts = {
                    "format": fmt,
                    "quiet": True,
                    "no_warnings": True,
                    "outtmpl": output_tpl,
                    "progress_hooks": [progress_hook],
                }
                if extra:
                    ydl_opts.update(extra)
                if not no_auth:
                    _apply_ydl_auth(ydl_opts)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([f"https://music.youtube.com/watch?v={video_id}"])
                last_dl_err = None
                break
            except Exception as dl_e:
                last_dl_err = dl_e
                if _is_hard_error(str(dl_e)):
                    break
                _logging.warning(f"[download] {video_id} fmt={fmt} auth={not no_auth}: {dl_e}")
        if last_dl_err:
            raise last_dl_err
        # Save metadata
        meta_path = _song_meta_path(video_id)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        _download_status[video_id] = "done"
        if video_id in _download_queue:
            _download_queue[video_id]["status"] = "done"
            _download_queue[video_id]["progress"] = 1.0
    except Exception as e:
        _download_status[video_id] = "error"
        if video_id in _download_queue:
            _download_queue[video_id]["status"] = "error"
            if "Music Premium" in str(e):
                _download_queue[video_id]["error_type"] = "premium_only"
        _logging.error(f"[download] {video_id}: {type(e).__name__}: {e}")


@app.route("/song/download/<video_id>", methods=["POST"])
def download_song(video_id):
    if _song_audio_path(video_id):
        _download_status[video_id] = "done"
        return jsonify({"ok": True, "status": "done"})
    if _download_status.get(video_id) == "downloading":
        return jsonify({"ok": True, "status": "downloading"})
    data = request.get_json() or {}
    meta = {
        "videoId": video_id,
        "title": data.get("title", ""),
        "artists": data.get("artists", ""),
        "album": data.get("album", ""),
        "duration": data.get("duration", ""),
        "thumbnail": data.get("thumbnail", ""),
    }
    _download_status[video_id] = "downloading"
    _download_queue[video_id] = {
        "videoId": video_id,
        "title": meta.get("title", ""),
        "artists": meta.get("artists", ""),
        "thumbnail": meta.get("thumbnail", ""),
        "status": "downloading",
        "progress": 0.0,
    }
    t = threading.Thread(target=_download_song_bg, args=(video_id, meta), daemon=True)
    t.start()
    return jsonify({"ok": True, "status": "downloading"})


@app.route("/song/download/status/<video_id>")
def download_status(video_id):
    if _song_audio_path(video_id):
        return jsonify({"status": "done"})
    status = _download_status.get(video_id, "not_found")
    return jsonify({"status": status})


@app.route("/downloads/queue")
def downloads_queue():
    # Return active + recently finished entries; clean up old "done"/"error" entries
    to_remove = [vid for vid, d in _download_queue.items() if d["status"] in ("done", "error")]
    # Keep them in response but prune after returning
    result = list(_download_queue.values())
    for vid in to_remove:
        _download_queue.pop(vid, None)
    return jsonify({"queue": result})


@app.route("/song/cached/<video_id>")
def serve_cached_song(video_id):
    from flask import send_file
    path = _song_audio_path(video_id)
    if not path:
        return jsonify({"error": "not cached"}), 404
    # Determine MIME type
    ext = os.path.splitext(path)[1].lower()
    mime = {".opus": "audio/opus", ".m4a": "audio/mp4", ".webm": "audio/webm", ".mp3": "audio/mpeg"}.get(ext, "application/octet-stream")
    return send_file(path, mimetype=mime)


@app.route("/song/cached/list")
def list_cached_songs():
    songs = []
    try:
        for f in os.listdir(SONG_CACHE_DIR):
            if f.endswith(".json"):
                try:
                    with open(os.path.join(SONG_CACHE_DIR, f), "r", encoding="utf-8") as fh:
                        meta = json.load(fh)
                        songs.append(meta)
                except Exception:
                    pass
    except Exception:
        pass
    return jsonify({"songs": songs})


@app.route("/song/cached/<video_id>", methods=["DELETE"])
def delete_cached_song(video_id):
    audio = _song_audio_path(video_id)
    if audio:
        try:
            os.remove(audio)
        except Exception:
            pass
    meta = _song_meta_path(video_id)
    if os.path.exists(meta):
        try:
            os.remove(meta)
        except Exception:
            pass
    _download_status.pop(video_id, None)
    return jsonify({"ok": True})


@app.route("/songs/cached/delete-batch", methods=["POST"])
def delete_cached_songs_batch():
    data = request.get_json() or {}
    video_ids = data.get("videoIds", [])
    for video_id in video_ids:
        audio = _song_audio_path(video_id)
        if audio:
            try:
                os.remove(audio)
            except Exception:
                pass
        meta = _song_meta_path(video_id)
        if os.path.exists(meta):
            try:
                os.remove(meta)
            except Exception:
                pass
        _download_status.pop(video_id, None)
    return jsonify({"ok": True, "removed": len(video_ids)})


# ─── Audio Export (Save to user-chosen location) ─────────────────────────────

_export_status = {}  # video_id -> "exporting" | "done" | "error"

def _find_ffmpeg():
    """Find ffmpeg binary — check bundled location first, then PATH."""
    bin_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    candidates = []
    if getattr(sys, 'frozen', False):
        # Next to the server executable (primary install-dir location)
        candidates.append(os.path.join(os.path.dirname(sys.executable), bin_name))
        # PyInstaller _MEIPASS temp dir (in case user bundled ffmpeg inside)
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            candidates.append(os.path.join(meipass, bin_name))
            # One level up from _MEIPASS (install dir)
            candidates.append(os.path.join(os.path.dirname(meipass), bin_name))
    else:
        candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), bin_name))

    for bundled in candidates:
        if os.path.exists(bundled):
            return os.path.dirname(bundled)

    # Check PATH
    import shutil as _sh
    if _sh.which("ffmpeg"):
        return None  # yt-dlp will find it in PATH
    return False  # not found

def _embed_metadata(file_path, meta, fmt="opus"):
    """Embed artist, title, album, year, and cover art into audio file."""
    try:
        import requests as _req
        from mutagen import File as MutagenFile
        title = meta.get("title", "")
        artists = meta.get("artists", "")
        album = meta.get("album", "")
        year = meta.get("year", "")
        thumbnail = meta.get("thumbnail", "")

        print(f"Metadata: embedding for {file_path} | title={title} | artists={artists} | album={album} | year={year} | thumbnail={thumbnail[:80] if thumbnail else 'EMPTY'}")

        # Download cover art and convert to JPEG for maximum compatibility
        cover_data = None
        cover_mime = "image/jpeg"
        if thumbnail:
            try:
                # Request high-res version (YouTube Music thumbnails support size params)
                thumb_url = thumbnail
                if "lh3.googleusercontent.com" in thumb_url:
                    # Replace size suffix to get 500x500 cover
                    import re
                    thumb_url = re.sub(r'=w\d+-h\d+.*$', '=w500-h500-l90-rj', thumb_url)
                    if '=' not in thumb_url:
                        thumb_url += '=w500-h500-l90-rj'
                r = _req.get(thumb_url, timeout=10)
                print(f"Metadata: thumbnail download status={r.status_code} content-type={r.headers.get('content-type','')} size={len(r.content)}")
                if r.ok and len(r.content) > 100:
                    ct = r.headers.get("content-type", "")
                    # Convert to JPEG for best compatibility (WebP is not widely supported in tags)
                    if "webp" in ct or "png" in ct or thumbnail.endswith(".webp") or thumbnail.endswith(".png"):
                        try:
                            from io import BytesIO
                            from PIL import Image
                            img = Image.open(BytesIO(r.content))
                            img = img.convert("RGB")
                            buf = BytesIO()
                            img.save(buf, format="JPEG", quality=90)
                            cover_data = buf.getvalue()
                            print(f"Metadata: converted image to JPEG, {len(cover_data)} bytes")
                        except ImportError:
                            # Pillow not available, use raw data with detected mime
                            cover_data = r.content
                            if "webp" in ct:
                                cover_mime = "image/webp"
                            elif "png" in ct:
                                cover_mime = "image/png"
                            print(f"Metadata: Pillow not available, using raw {cover_mime}")
                        except Exception as img_err:
                            print(f"Metadata: image conversion failed: {img_err}, using raw")
                            cover_data = r.content
                    else:
                        cover_data = r.content
                        print(f"Metadata: using JPEG cover, {len(cover_data)} bytes")
                else:
                    print(f"Metadata: thumbnail download failed or empty")
            except Exception as e:
                print(f"Metadata: thumbnail download error: {e}")
        else:
            print(f"Metadata: no thumbnail URL provided")

        # Auto-detect actual container format
        audio = MutagenFile(file_path)
        if audio is None:
            print(f"Metadata: mutagen could not identify {file_path}")
            return

        type_name = type(audio).__name__
        print(f"Metadata: detected {type_name} for {file_path}")

        if type_name in ("OggOpus", "OggVorbis"):
            if title:
                audio["title"] = [title]
            if artists:
                audio["artist"] = [artists]
            if album:
                audio["album"] = [album]
            if year:
                audio["date"] = [str(year)]
            if cover_data:
                from mutagen.flac import Picture
                import base64
                pic = Picture()
                pic.type = 3
                pic.mime = cover_mime
                pic.desc = "Cover"
                pic.data = cover_data
                audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
                print(f"Metadata: embedded OGG cover ({len(cover_data)} bytes, {cover_mime})")
            audio.save()
            print(f"Metadata: OGG tags saved successfully")

        elif type_name == "MP3":
            from mutagen.id3 import TIT2, TPE1, TALB, TDRC, TYER, APIC
            if audio.tags is None:
                audio.add_tags()
            tags = audio.tags
            if title:
                tags.add(TIT2(encoding=3, text=[title]))
            if artists:
                tags.add(TPE1(encoding=3, text=[artists]))
            if album:
                tags.add(TALB(encoding=3, text=[album]))
            if year:
                tags.add(TDRC(encoding=3, text=[str(year)]))
                tags.add(TYER(encoding=3, text=[str(year)]))  # ID3v2.3 year tag for Windows compatibility
            if cover_data:
                tags.add(APIC(encoding=3, mime=cover_mime, type=3, desc="Cover", data=cover_data))
                print(f"Metadata: embedded MP3 cover ({len(cover_data)} bytes, {cover_mime})")
            # Save as ID3v2.3 for Windows Explorer compatibility
            audio.save(v2_version=3)
            print(f"Metadata: MP3 tags saved as ID3v2.3 successfully")

        elif type_name in ("MP4",):
            if title:
                audio["\xa9nam"] = [title]
            if artists:
                audio["\xa9ART"] = [artists]
            if album:
                audio["\xa9alb"] = [album]
            if year:
                audio["\xa9day"] = [str(year)]
            if cover_data:
                from mutagen.mp4 import MP4Cover
                audio["covr"] = [MP4Cover(cover_data, imageformat=MP4Cover.FORMAT_JPEG)]
            audio.save()

        else:
            print(f"Metadata: unsupported format {type_name} for {file_path}")

    except Exception as e:
        print(f"Metadata embed error: {e}")


def _export_audio_bg(video_id, output_path, fmt="opus", meta=None):
    """Download / convert song and save to user-chosen path."""
    global _export_status
    try:
        import yt_dlp, shutil, tempfile

        # For OPUS: download, convert WebM→OGG/Opus via ffmpeg, then tag with mutagen
        if fmt == "opus":
            tmp_dir = tempfile.mkdtemp()
            tmp_tpl = os.path.join(tmp_dir, "export.%(ext)s")
            ffmpeg_dir = _find_ffmpeg()
            last_exp_err = None
            for fmt, extra, no_auth in _STREAM_ATTEMPTS:
                try:
                    ydl_opts = {
                        "format": fmt,
                        "quiet": True,
                        "no_warnings": True,
                        "outtmpl": tmp_tpl,
                    }
                    if extra:
                        ydl_opts.update(extra)
                    if not no_auth:
                        _apply_ydl_auth(ydl_opts)
                    # Convert to proper OGG/Opus via ffmpeg so mutagen can tag it
                    if ffmpeg_dir is not False:
                        ydl_opts["postprocessors"] = [{
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "opus",
                            "preferredquality": "0",
                        }]
                        if ffmpeg_dir:
                            ydl_opts["ffmpeg_location"] = ffmpeg_dir
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        ydl.download([f"https://music.youtube.com/watch?v={video_id}"])
                    last_exp_err = None
                    break
                except Exception as exp_e:
                    last_exp_err = exp_e
                    if _is_hard_error(str(exp_e)):
                        break
                    _logging.warning(f"[export-opus] {video_id} fmt={fmt} auth={not no_auth}: {exp_e}")
            if last_exp_err:
                raise last_exp_err
            # Find the resulting file
            for f in os.listdir(tmp_dir):
                if f.startswith("export.") and not f.endswith((".json", ".jpg", ".png", ".webp")):
                    src = os.path.join(tmp_dir, f)
                    shutil.move(src, output_path)
                    break
            # Now embed metadata via mutagen (works on proper OGG/Opus files)
            if meta and os.path.exists(output_path):
                _embed_metadata(output_path, meta, "opus")
            _export_status[video_id] = "done"
            try:
                shutil.rmtree(tmp_dir)
            except Exception:
                pass
            return

        # For MP3: need ffmpeg
        ffmpeg_dir = _find_ffmpeg()
        if ffmpeg_dir is False:
            _export_status[video_id] = "error"
            print(f"MP3 export error: ffmpeg not found")
            return

        tmp_dir = tempfile.mkdtemp()
        tmp_tpl = os.path.join(tmp_dir, "export.%(ext)s")
        last_mp3_err = None
        for fmt, extra, no_auth in _STREAM_ATTEMPTS:
            try:
                ydl_opts = {
                    "format": fmt,
                    "quiet": True,
                    "no_warnings": True,
                    "outtmpl": tmp_tpl,
                    "postprocessors": [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }],
                }
                if extra:
                    ydl_opts.update(extra)
                if not no_auth:
                    _apply_ydl_auth(ydl_opts)
                if ffmpeg_dir:
                    ydl_opts["ffmpeg_location"] = ffmpeg_dir
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([f"https://music.youtube.com/watch?v={video_id}"])
                last_mp3_err = None
                break
            except Exception as mp3_e:
                last_mp3_err = mp3_e
                if _is_hard_error(str(mp3_e)):
                    break
                _logging.warning(f"[export-mp3] {video_id} fmt={fmt} auth={not no_auth}: {mp3_e}")
        if last_mp3_err:
            raise last_mp3_err

        mp3 = os.path.join(tmp_dir, "export.mp3")
        if os.path.exists(mp3):
            shutil.move(mp3, output_path)
        if meta and os.path.exists(output_path):
            _embed_metadata(output_path, meta, "mp3")
        _export_status[video_id] = "done"
        try:
            shutil.rmtree(tmp_dir)
        except Exception:
            pass
    except Exception as e:
        _export_status[video_id] = "error"
        print(f"Audio export error for {video_id}: {e}")


@app.route("/song/export/<video_id>", methods=["POST"])
def export_audio(video_id):
    data = request.get_json() or {}
    output_path = data.get("output_path", "")
    fmt = data.get("format", "opus")  # "mp3" or "opus"
    if not output_path:
        return jsonify({"error": "output_path required"}), 400
    if _export_status.get(video_id) == "exporting":
        return jsonify({"ok": True, "status": "exporting"})
    year = data.get("year", "")
    album_browse_id = data.get("albumBrowseId", "")
    print(f"Export request: video_id={video_id} fmt={fmt} year='{year}' albumBrowseId='{album_browse_id}' thumbnail='{data.get('thumbnail','')[:60]}'")
    # Try to fetch year from album data if not provided
    if not year and album_browse_id:
        try:
            album_data = get_ytmusic().get_album(album_browse_id)
            year = album_data.get("year", "")
            print(f"Export: fetched year={year} from album {album_browse_id}")
        except Exception as e:
            print(f"Export: failed to fetch album year: {e}")
    # Fallback: fetch song info to get year from the song's album
    if not year:
        try:
            song_info = get_ytmusic().get_song(video_id)
            vd = song_info.get("videoDetails", {})
            # Try microformat for year
            mf = song_info.get("microformat", {}).get("microformatDataRenderer", {})
            upload_date = mf.get("uploadDate", "")  # e.g. "2022-06-17"
            if upload_date and len(upload_date) >= 4:
                year = upload_date[:4]
                print(f"Export: got year={year} from song upload date")
        except Exception as e:
            print(f"Export: failed to fetch song info for year: {e}")
    meta = {
        "title": data.get("title", ""),
        "artists": data.get("artists", ""),
        "album": data.get("album", ""),
        "year": year,
        "thumbnail": data.get("thumbnail", ""),
    }
    _export_status[video_id] = "exporting"
    t = threading.Thread(target=_export_audio_bg, args=(video_id, output_path, fmt, meta), daemon=True)
    t.start()
    return jsonify({"ok": True, "status": "exporting"})


@app.route("/song/export/status/<video_id>")
def export_status(video_id):
    status = _export_status.get(video_id, "not_found")
    return jsonify({"status": status})


@app.route("/song/export/ffmpeg-available")
def ffmpeg_available():
    return jsonify({"available": _find_ffmpeg() is not False})


# ─── FFmpeg auto-download ─────────────────────────────────────────────────────

@app.route("/ffmpeg/status")
def ffmpeg_status():
    """Returns whether ffmpeg is available next to the server binary."""
    return jsonify({"available": _find_ffmpeg() is not False})


@app.route("/ffmpeg/download")
def ffmpeg_download():
    """
    SSE stream that downloads ffmpeg.exe from gyan.dev and places it next to
    the server executable (install dir).  Events:
      data: {"status": "progress", "percent": 0-100, "mb_done": x, "mb_total": y, "speed_kbps": z}
      data: {"status": "done"}
      data: {"status": "error", "message": "..."}
    """
    import zipfile, io, struct

    def _stream():
        # Only runs when frozen (installed); in dev just report done.
        if not getattr(sys, 'frozen', False):
            yield "data: {\"status\": \"done\"}\n\n"
            return

        dest_dir = os.path.dirname(sys.executable)
        dest_exe = os.path.join(dest_dir, "ffmpeg.exe")

        if os.path.exists(dest_exe):
            yield "data: {\"status\": \"done\"}\n\n"
            return

        url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        try:
            import requests as _req
            with _req.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                downloaded = 0
                chunks = []
                start_ts = time.time()
                last_emit = 0

                for chunk in r.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    chunks.append(chunk)
                    downloaded += len(chunk)
                    now = time.time()
                    if now - last_emit >= 0.25:
                        elapsed = max(now - start_ts, 0.001)
                        speed_kbps = int(downloaded / elapsed / 1024)
                        percent = int(downloaded / total * 100) if total else 0
                        mb_done  = round(downloaded / 1048576, 1)
                        mb_total = round(total / 1048576, 1) if total else 0
                        payload = json.dumps({
                            "status": "progress",
                            "percent": percent,
                            "mb_done": mb_done,
                            "mb_total": mb_total,
                            "speed_kbps": speed_kbps,
                        })
                        yield f"data: {payload}\n\n"
                        last_emit = now

                # Extract ffmpeg.exe from ZIP
                zip_data = b"".join(chunks)
                with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                    ffmpeg_entry = next(
                        (n for n in zf.namelist()
                         if n.endswith("/ffmpeg.exe") or n == "ffmpeg.exe"),
                        None
                    )
                    if not ffmpeg_entry:
                        yield "data: {\"status\": \"error\", \"message\": \"ffmpeg.exe not found in ZIP\"}\n\n"
                        return
                    with zf.open(ffmpeg_entry) as src, open(dest_exe, "wb") as dst:
                        dst.write(src.read())

                yield "data: {\"status\": \"done\"}\n\n"

        except Exception as e:
            payload = json.dumps({"status": "error", "message": str(e)})
            yield f"data: {payload}\n\n"

    return Response(
        _stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/lyrics/custom/<video_id>", methods=["GET"])
def get_custom_lyrics(video_id):
    """Gibt manuell importierte Lyrics für eine videoId zurück."""
    for ext in ("lrc", "ttml"):
        path = os.path.join(CUSTOM_LYRICS_DIR, f"{video_id}.{ext}")
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return jsonify({"content": content, "format": ext})
    return jsonify({"error": "not found"}), 404


@app.route("/lyrics/custom", methods=["POST"])
def save_custom_lyrics():
    """Speichert manuell importierte Lyrics für eine videoId."""
    data = request.get_json()
    video_id = data.get("videoId", "").strip()
    content = data.get("content", "")
    fmt = data.get("format", "lrc").lower()
    if not video_id or not content or fmt not in ("lrc", "ttml"):
        return jsonify({"error": "invalid request"}), 400
    # Eventuelle andere Datei desselben Songs entfernen
    for ext in ("lrc", "ttml"):
        old = os.path.join(CUSTOM_LYRICS_DIR, f"{video_id}.{ext}")
        if os.path.isfile(old):
            os.remove(old)
    path = os.path.join(CUSTOM_LYRICS_DIR, f"{video_id}.{fmt}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return jsonify({"ok": True})


@app.route("/lyrics/custom/<video_id>", methods=["DELETE"])
def delete_custom_lyrics(video_id):
    """Löscht manuell importierte Lyrics für eine videoId."""
    deleted = False
    for ext in ("lrc", "ttml"):
        path = os.path.join(CUSTOM_LYRICS_DIR, f"{video_id}.{ext}")
        if os.path.isfile(path):
            os.remove(path)
            deleted = True
    if deleted:
        return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404


@app.route("/debug/info")
def debug_info():
    """Returns system info + last log entries for the Debug tab in the frontend."""
    import platform as _platform, shutil as _shutil

    def _pkg_version(name):
        try:
            import importlib.metadata
            return importlib.metadata.version(name)
        except Exception:
            return "—"

    node_path = _shutil.which("node") or _shutil.which("node.exe") or _shutil.which("nodejs")

    uptime_s = int(time.time() - _server_start_time)
    h, rem = divmod(uptime_s, 3600)
    m, s   = divmod(rem, 60)
    uptime_str = (f"{h}h " if h else "") + f"{m}m {s}s"

    with _debug_log_lock:
        logs = list(_debug_log)

    return jsonify({
        "python":     sys.version.split()[0],
        "ytdlp":      _pkg_version("yt-dlp"),
        "ytmusicapi": _pkg_version("ytmusicapi"),
        "flask":      _pkg_version("flask"),
        "node":       node_path,
        "profile":    _current_profile or "—",
        "platform":   _platform.system() + " " + _platform.release(),
        "uptime":     uptime_str,
        "data_dir":   _base_dir,
        "logs":       logs[-300:],
    })


# ─── OBS Overlay Server ───────────────────────────────────────────────────────
import queue as _qmod
from werkzeug.serving import make_server as _make_wsgi_server

_ov_state = {
    "title": "", "artist": "", "album": "",
    "cover": "", "progress": 0.0, "duration": 0.0, "isPlaying": False,
}
_ov_config = {
    "preset": "basic",
    "bgColor": "#1a1a1a", "bgOpacity": 90,
    "accentColor": "#EEA8FF", "textColor": "#ffffff",
    "borderRadius": 14,
    "showProgress": True, "showAlbumArt": True,
    "showArtist": True, "showAlbum": False,
    "border": False, "borderColor": "#EEA8FF",
    "fontFamily": "system-ui, sans-serif", "fontSize": 14,
}
_ov_clients: list = []
_ov_lock  = threading.Lock()
_ov_server_obj  = None
_ov_server_thread = None

_ov_app = Flask("kiyoshi_overlay")
CORS(_ov_app)

# ── Widget HTML ───────────────────────────────────────────────────────────────
_OVERLAY_HTML = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;overflow:hidden;font-family:var(--wfont)}
#w{
  display:inline-flex;align-items:center;gap:12px;
  padding:10px 16px 10px 10px;
  border-radius:var(--wr);
  background:var(--wbg);
  border:var(--wborder);
  min-width:220px;max-width:420px;
  position:relative;overflow:hidden;
  transition:background .3s,border .3s;
}
#art{width:52px;height:52px;border-radius:calc(var(--wr) - 4px);object-fit:cover;flex-shrink:0;transition:opacity .3s}
#art-ph{width:52px;height:52px;border-radius:calc(var(--wr) - 4px);background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.info{flex:1;min-width:0}
.title{font-size:var(--wfs);font-weight:700;color:var(--wtxt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .3s}
.sub{font-size:calc(var(--wfs) - 2px);color:var(--wtxts);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pbar{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.12)}
#pfill{height:100%;background:var(--wacc);border-radius:0 2px 2px 0;transition:width .8s linear}
@keyframes scroll{0%{transform:translateX(0)}40%{transform:translateX(var(--scroll-dist))}60%{transform:translateX(var(--scroll-dist))}100%{transform:translateX(0)}}
.scroll{animation:scroll 8s ease-in-out infinite;display:inline-block;white-space:nowrap}
</style></head>
<body><div id="w">
  <div id="art-ph"><svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,.4)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
  <img id="art" style="display:none" crossorigin="anonymous">
  <div class="info">
    <div class="title"><span id="title-span">No Music</span></div>
    <div class="sub" id="sub">Waiting...</div>
  </div>
  <div id="pbar"><div id="pfill" style="width:0%"></div></div>
</div>
<script>
const API=location.origin;
let cfg={},state={};

function rgba(hex,a){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`rgba(${r},${g},${b},${a})`}

function applyConfig(c){
  cfg=c;
  const R=document.documentElement;
  R.style.setProperty('--wr',(c.borderRadius??14)+'px');
  R.style.setProperty('--wbg',rgba(c.bgColor||'#1a1a1a',(c.bgOpacity??90)/100));
  R.style.setProperty('--wacc',c.accentColor||'#EEA8FF');
  R.style.setProperty('--wtxt',c.textColor||'#fff');
  R.style.setProperty('--wtxts',rgba(c.textColor||'#fff',.65));
  R.style.setProperty('--wfs',(c.fontSize||14)+'px');
  R.style.setProperty('--wfont',c.fontFamily||'system-ui,sans-serif');
  document.getElementById('w').style.border=c.border?`1.5px solid ${c.borderColor||'#EEA8FF'}`:'none';
  document.getElementById('pbar').style.display=c.showProgress===false?'none':'';
  const hasArt=c.showAlbumArt!==false;
  document.getElementById('art').style.display=hasArt&&state.cover?'':'none';
  document.getElementById('art-ph').style.display=hasArt&&!state.cover?'':'none';
  if(!hasArt){document.getElementById('art').style.display='none';document.getElementById('art-ph').style.display='none';}
  renderSub();
}

function renderSub(){
  const parts=[];
  if(cfg.showArtist!==false&&state.artist)parts.push(state.artist);
  if(cfg.showAlbum&&state.album)parts.push(state.album);
  document.getElementById('sub').textContent=parts.join(' · ')||'Waiting...';
}

function checkScroll(){
  const sp=document.getElementById('title-span');
  const w=document.getElementById('w');
  const overflow=sp.scrollWidth-(w.clientWidth-100);
  if(overflow>20){
    sp.style.setProperty('--scroll-dist',`-${overflow}px`);
    sp.classList.add('scroll');
  } else {
    sp.classList.remove('scroll');
  }
}

function updateState(s){
  if(s._configUpdate){applyConfig(s.config||s);return;}
  if(s._config){applyConfig(s._config);delete s._config;}
  state=s;
  document.getElementById('title-span').textContent=s.title||'No Music';
  renderSub();
  const art=document.getElementById('art'),ph=document.getElementById('art-ph');
  if(s.cover&&cfg.showAlbumArt!==false){
    art.src=s.cover;art.style.display='';ph.style.display='none';
  } else if(cfg.showAlbumArt!==false){
    art.style.display='none';ph.style.display='';
  }
  const pct=s.duration>0?(s.progress/s.duration*100):0;
  document.getElementById('pfill').style.width=pct+'%';
  setTimeout(checkScroll,100);
}

function connect(){
  const es=new EventSource(API+'/overlay/stream');
  es.onmessage=e=>{try{updateState(JSON.parse(e.data));}catch(_){}};
  es.onerror=()=>{es.close();setTimeout(connect,3000);};
}

fetch(API+'/overlay/config').then(r=>r.json()).then(c=>{applyConfig(c);connect();}).catch(()=>connect());
</script></body></html>"""

def _ov_push(payload: dict):
    msg = "data: " + json.dumps(payload) + "\n\n"
    with _ov_lock:
        dead = []
        for q in _ov_clients:
            try:
                q.put_nowait(msg)
            except _qmod.Full:
                dead.append(q)
        for q in dead:
            try: _ov_clients.remove(q)
            except ValueError: pass

@_ov_app.route("/overlay")
def _ov_page():
    return Response(_OVERLAY_HTML, content_type="text/html; charset=utf-8")

@_ov_app.route("/overlay/stream")
def _ov_stream():
    q = _qmod.Queue(maxsize=30)
    with _ov_lock:
        _ov_clients.append(q)
    initial = "data: " + json.dumps({**_ov_state, "_config": _ov_config}) + "\n\n"
    def _gen():
        try:
            yield initial
            while True:
                try:
                    yield q.get(timeout=25)
                except _qmod.Empty:
                    yield ": ping\n\n"
        finally:
            with _ov_lock:
                try: _ov_clients.remove(q)
                except ValueError: pass
    return Response(_gen(), content_type="text/event-stream",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no",
                             "Access-Control-Allow-Origin":"*"})

@_ov_app.route("/overlay/config")
def _ov_config_endpoint():
    return jsonify(_ov_config)

def _ov_start(port: int) -> bool:
    global _ov_server_obj, _ov_server_thread
    _ov_stop()
    try:
        srv = _make_wsgi_server("0.0.0.0", port, _ov_app)
        _ov_server_obj = srv
        t = threading.Thread(target=srv.serve_forever, daemon=True, name="kiyoshi-overlay")
        t.start()
        _ov_server_thread = t
        return True
    except OSError as e:
        print(f"[Overlay] Port {port} unavailable: {e}")
        return False

def _ov_stop():
    global _ov_server_obj, _ov_server_thread
    if _ov_server_obj:
        try: _ov_server_obj.shutdown()
        except Exception: pass
        _ov_server_obj = None
    _ov_server_thread = None

# ── Main-server control endpoints ─────────────────────────────────────────────
@app.route("/overlay/push", methods=["POST"])
def overlay_push():
    global _ov_state
    data = request.json or {}
    _ov_state.update({k: v for k, v in data.items() if k in _ov_state})
    _ov_push(_ov_state)
    return jsonify({"ok": True})

@app.route("/overlay/config", methods=["GET", "POST"])
def overlay_config():
    global _ov_config
    if request.method == "POST":
        _ov_config.update(request.json or {})
        _ov_push({"_configUpdate": True, "config": _ov_config})
        return jsonify({"ok": True})
    return jsonify(_ov_config)

@app.route("/overlay/server/start", methods=["POST"])
def overlay_server_start():
    port = (request.json or {}).get("port", 9848)
    ok = _ov_start(int(port))
    return jsonify({"ok": ok, "port": port})

@app.route("/overlay/server/stop", methods=["POST"])
def overlay_server_stop():
    _ov_stop()
    return jsonify({"ok": True})

@app.route("/overlay/status")
def overlay_status():
    return jsonify({"running": _ov_server_obj is not None, "clients": len(_ov_clients)})

if __name__ == "__main__":
    import socket as _socket, traceback as _tb

    # ── Persistent log file for diagnosing startup problems ──────────────────
    _log_path = os.path.join(_base_dir, "server_startup.log")

    def _log(msg):
        """Append a timestamped line to the startup log. Never raises."""
        try:
            with open(_log_path, "a", encoding="utf-8") as _f:
                _f.write(f"[{time.time():.3f}] {msg}\n")
                _f.flush()
        except Exception:
            pass

    # Fresh log on each start
    try:
        open(_log_path, "w").close()
    except Exception:
        pass

    _log("process started")
    _log(f"python={sys.version}")
    _log(f"frozen={getattr(sys, 'frozen', False)}")
    _log(f"base_dir={_base_dir}")

    # ── Check / free port 9847 ────────────────────────────────────────────────
    def _port_free(port=9847):
        try:
            _s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
            _s.settimeout(0.3)
            result = _s.connect_ex(("127.0.0.1", port))
            _s.close()
            return result != 0  # non-zero means nothing listening
        except Exception:
            return True

    # Single-instance: ask any existing server to shut down first
    def _kill_existing():
        try:
            import urllib.request
            urllib.request.urlopen("http://127.0.0.1:9847/shutdown", timeout=2)
            _log("sent /shutdown to existing server")
        except Exception:
            pass
        time.sleep(0.5)

    _log("checking port 9847 ...")
    if not _port_free():
        _log("port occupied — sending shutdown and waiting")
        _kill_existing()
        time.sleep(0.5)
    else:
        _log("port 9847 is free")

    # ── Start Flask ───────────────────────────────────────────────────────────
    # Suppress Werkzeug's own startup print() calls — they fail under
    # CREATE_NO_WINDOW because there is no attached console handle.
    # Werkzeug request logs (INFO) → captured by _RingBufferHandler into ring buffer.
    # Do NOT suppress them — _RingBufferHandler writes to memory, not stdout.

    # ── Self-test: after Flask is up, verify we can actually reach ourselves ──
    def _self_test():
        import urllib.request as _ur
        time.sleep(3)  # give Flask time to fully bind
        for _host in ("127.0.0.1", "localhost", "::1"):
            try:
                _url = f"http://{_host}:9847/status"
                resp = _ur.urlopen(_url, timeout=3)
                _log(f"self-test {_url} → HTTP {resp.status} OK")
            except Exception as _e:
                _log(f"self-test {_url} → FAILED: {type(_e).__name__}: {_e}")

    import threading as _thr
    _thr.Thread(target=_self_test, daemon=True).start()

    _log("calling app.run ...")
    try:
        # Listen on all IPv4+IPv6 interfaces so both localhost→127.0.0.1
        # and localhost→::1 (modern Windows) can reach us.
        app.run(host="0.0.0.0", port=9847, debug=False, threaded=True,
                use_reloader=False)
        _log("app.run returned cleanly")
    except BaseException as _e:
        _log(f"CRASH: {type(_e).__name__}: {_e}")
        try:
            with open(_log_path, "a", encoding="utf-8") as _f:
                _tb.print_exc(file=_f)
        except Exception:
            pass
        raise
