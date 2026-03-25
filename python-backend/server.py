"""
Kiyoshi Music - Python Backend
Lokaler API-Server der ytmusicapi nutzt.
Starte mit: python server.py
"""

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from ytmusicapi import YTMusic
import sys, os, json, glob, threading, time, requests

app = Flask(__name__)
CORS(app)

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

# Active YTMusic instance and current profile
_ytm = None
_current_profile = None
_playlist_cache = {}  # in-memory for this session
_adding_account = False
_download_status = {}  # video_id -> "downloading" | "done" | "error"

# Cache feature flags (can be toggled at runtime via /cache/settings)
_cache_enabled = {"playlists": True, "albums": True, "images": True, "songs": True, "lyrics": True}

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

def get_profiles():
    profiles = []
    for p in glob.glob(os.path.join(PROFILES_DIR, "*.json")):
        name = os.path.splitext(os.path.basename(p))[0]
        if name.endswith(".meta"):
            continue
        # Skip meta files
        if name.endswith(".meta"):
            continue
        meta_path = os.path.join(PROFILES_DIR, f"{name}.meta.json")
        meta = {}
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
        profiles.append({
            "name": name,
            "displayName": meta.get("displayName", name),
            "handle": meta.get("handle", ""),
            "avatar": meta.get("avatar", ""),
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
            meta["avatar"] = (info.get("accountPhoto") or [{}])[-1].get("url", "")
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
    meta_path = os.path.join(PROFILES_DIR, f"{name}.meta.json")
    if os.path.exists(path):
        os.remove(path)
    if os.path.exists(meta_path):
        os.remove(meta_path)
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
        _playlist_cache = {}
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
        _playlist_cache = {}

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
    # Just check if profile file exists - don't make API call every time
    if _current_profile and os.path.exists(profile_path(_current_profile)):
        return jsonify({"valid": True, "profile": _current_profile})
    return jsonify({"valid": False, "reason": "no_profile"})

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

# In-memory cache für Lyrics-Übersetzungen
_translation_cache = {}

# Romaji-Konverter (lazy init)
_kakasi = None
_romaji_cache = {}
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
        _romaji_cache[cache_key] = romaji
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
        _translation_cache[cache_key] = translated_lines
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
            _playlist_cache = {}
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

@app.route("/stream/<video_id>")
def stream_url(video_id):
    try:
        import yt_dlp
        # Prefer M4A/AAC: supported by the Rust audio player (rodio+symphonia).
        # Falls back to any bestaudio if M4A is unavailable.
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio",
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://music.youtube.com/watch?v={video_id}",
                download=False
            )
        # Prefer direct URL on the info dict; fall back to best audio format
        url = info.get("url")
        if not url and info.get("formats"):
            audio_fmts = [f for f in info["formats"]
                          if f.get("acodec") != "none" and f.get("vcodec") == "none"]
            chosen = audio_fmts[-1] if audio_fmts else info["formats"][-1]
            url = chosen.get("url")
        if not url:
            return jsonify({"error": "Keine URL gefunden"}), 404
        return jsonify({"url": url})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/stream-prepare/<video_id>")
def stream_prepare(video_id):
    """Download audio via yt-dlp to a temp file and return the local path.
    Rust reads from disk — no HTTP proxy overhead, no truncation."""
    import tempfile, glob as _glob
    cache_dir = os.path.join(tempfile.gettempdir(), "kiyoshi-audio")
    os.makedirs(cache_dir, exist_ok=True)

    # Check if already downloaded
    existing = _glob.glob(os.path.join(cache_dir, f"{video_id}.*"))
    if existing and os.path.getsize(existing[0]) > 0:
        print(f"[stream-prepare] Cache hit: {existing[0]}", flush=True)
        return jsonify({"path": existing[0]})

    try:
        import yt_dlp
        outtmpl = os.path.join(cache_dir, "%(id)s.%(ext)s")
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio",
            "outtmpl": outtmpl,
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://music.youtube.com/watch?v={video_id}",
                download=True
            )
            path = ydl.prepare_filename(info)

        print(f"[stream-prepare] Downloaded: {path} ({os.path.getsize(path)} bytes)", flush=True)
        return jsonify({"path": path})
    except Exception as e:
        print(f"[stream-prepare] Error: {e}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route("/library/playlists")
def library_playlists():
    try:
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
        get_ytmusic().edit_playlist(playlist_id, title=title, description=description, privacyStatus=privacy)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/playlist/<playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id):
    try:
        get_ytmusic().delete_playlist(playlist_id)
        _purge_playlist_cache(playlist_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/library/albums")
def library_albums():
    try:
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
                    _playlist_cache[playlist_id] = disk  # warm in-memory cache too
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
                    _playlist_cache[playlist_id] = data
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
                _playlist_cache[playlist_id] = data
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

    # Fetch from YouTube CDN
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://music.youtube.com/",
        })
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
        rating = data.get("rating", "LIKE")  # LIKE, DISLIKE, INDIFFERENT
        get_ytmusic().rate_song(video_id, rating)
        return jsonify({"ok": True, "rating": rating})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/liked/ids")
def liked_ids():
    try:
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
    global _download_status
    try:
        import yt_dlp
        safe = video_id.replace("/", "_").replace("\\", "_")
        output_tpl = os.path.join(SONG_CACHE_DIR, safe + ".%(ext)s")
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio",
            "quiet": True,
            "no_warnings": True,
            "outtmpl": output_tpl,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://music.youtube.com/watch?v={video_id}"])
        # Save metadata
        meta_path = _song_meta_path(video_id)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        _download_status[video_id] = "done"
    except Exception as e:
        _download_status[video_id] = "error"
        print(f"Download error for {video_id}: {e}")


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
    t = threading.Thread(target=_download_song_bg, args=(video_id, meta), daemon=True)
    t.start()
    return jsonify({"ok": True, "status": "downloading"})


@app.route("/song/download/status/<video_id>")
def download_status(video_id):
    if _song_audio_path(video_id):
        return jsonify({"status": "done"})
    status = _download_status.get(video_id, "not_found")
    return jsonify({"status": status})


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
            ydl_opts = {
                "format": "bestaudio[ext=webm]/bestaudio",
                "quiet": True,
                "no_warnings": True,
                "outtmpl": tmp_tpl,
            }
            # Convert WebM to proper OGG/Opus so mutagen can tag it
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
        ydl_opts = {
            "format": "bestaudio",
            "quiet": True,
            "no_warnings": True,
            "outtmpl": tmp_tpl,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        }
        if ffmpeg_dir:
            ydl_opts["ffmpeg_location"] = ffmpeg_dir
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://music.youtube.com/watch?v={video_id}"])

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


if __name__ == "__main__":
    import socket, sys, signal

    # Single-instance: check if already running, kill it first
    def kill_existing():
        try:
            import urllib.request
            urllib.request.urlopen("http://localhost:9847/shutdown", timeout=2)
        except:
            pass
        import time
        time.sleep(0.5)

    kill_existing()

    print("Kiyoshi Music Backend startet auf http://localhost:9847")
    app.run(port=9847, debug=False, threaded=True)
