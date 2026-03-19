#!/usr/bin/env python3
"""
Kiyoshi Music - ytmusicapi Bridge Server
Lauscht auf localhost:9847 und stellt die YT Music API als HTTP-Endpunkte bereit.
Beim ersten Start: python server.py --setup
"""

import sys
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    from ytmusicapi import YTMusic
except ImportError:
    print("ytmusicapi nicht gefunden. Bitte ausführen: pip install ytmusicapi")
    sys.exit(1)

PORT = 9847
yt = None

def init_ytmusic():
    global yt
    try:
        yt = YTMusic("oauth.json")
        print(f"[OK] YTMusic mit OAuth initialisiert")
    except Exception as e:
        try:
            yt = YTMusic()
            print(f"[OK] YTMusic ohne Auth initialisiert (eingeschränkte Funktionen)")
        except Exception as e2:
            print(f"[FEHLER] YTMusic konnte nicht initialisiert werden: {e2}")
            sys.exit(1)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Stilles Logging

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, msg, code=500):
        self.send_json({"error": msg}, code)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        def p(key, default=None):
            return params.get(key, [default])[0]

        try:
            # ---- Gesundheitscheck ----
            if path == "/ping":
                self.send_json({"status": "ok", "auth": yt.auth_type if hasattr(yt, 'auth_type') else "unknown"})

            # ---- Startseite / Home ----
            elif path == "/home":
                data = yt.get_home(limit=int(p("limit", 6)))
                self.send_json(data)

            # ---- Liked Songs ----
            elif path == "/liked":
                limit = int(p("limit", 50))
                data = yt.get_liked_songs(limit=limit)
                self.send_json(data)

            # ---- Bibliothek: Playlists ----
            elif path == "/library/playlists":
                data = yt.get_library_playlists(limit=int(p("limit", 25)))
                self.send_json(data)

            # ---- Playlist-Inhalt ----
            elif path == "/playlist":
                playlist_id = p("id")
                if not playlist_id:
                    self.send_error_json("id parameter fehlt", 400)
                    return
                data = yt.get_playlist(playlist_id, limit=int(p("limit", 100)))
                self.send_json(data)

            # ---- Suche ----
            elif path == "/search":
                query = p("q")
                if not query:
                    self.send_error_json("q parameter fehlt", 400)
                    return
                filter_type = p("filter", None)
                data = yt.search(query, filter=filter_type, limit=int(p("limit", 20)))
                self.send_json(data)

            # ---- Song-Streaming-URL ----
            elif path == "/stream":
                video_id = p("id")
                if not video_id:
                    self.send_error_json("id parameter fehlt", 400)
                    return
                # Hole Streaming-Infos via ytmusicapi
                data = yt.get_song(video_id)
                self.send_json(data)

            # ---- Artist-Info ----
            elif path == "/artist":
                channel_id = p("id")
                if not channel_id:
                    self.send_error_json("id parameter fehlt", 400)
                    return
                data = yt.get_artist(channel_id)
                self.send_json(data)

            # ---- Album-Info ----
            elif path == "/album":
                browse_id = p("id")
                if not browse_id:
                    self.send_error_json("id parameter fehlt", 400)
                    return
                data = yt.get_album(browse_id)
                self.send_json(data)

            # ---- Unbekannte Route ----
            else:
                self.send_error_json(f"Unbekannte Route: {path}", 404)

        except Exception as e:
            print(f"[FEHLER] {path}: {e}")
            self.send_error_json(str(e))


def setup_oauth():
    print("\n=== Kiyoshi Music - OAuth Setup ===")
    print("Dieser Schritt verknüpft die App mit deinem Google-Account.")
    print("Du wirst auf eine Google-Login-Seite weitergeleitet.\n")
    try:
        YTMusic.setup_oauth(filepath="oauth.json", open_browser=True)
        print("\n[OK] oauth.json wurde erstellt. Du kannst den Server jetzt normal starten.")
    except Exception as e:
        print(f"\n[FEHLER] OAuth Setup fehlgeschlagen: {e}")


def setup_browser():
    print("\n=== Kiyoshi Music - Browser Auth Setup ===")
    print("Öffne YouTube Music in Chrome/Edge, öffne die Entwicklertools (F12),")
    print("gehe zu Netzwerk, lade die Seite neu, klicke auf eine Anfrage an music.youtube.com,")
    print("und kopiere den 'Request Headers'-Wert.\n")
    try:
        YTMusic.setup(filepath="browser.json")
        print("\n[OK] browser.json wurde erstellt.")
    except Exception as e:
        print(f"\n[FEHLER]: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kiyoshi Music API Bridge")
    parser.add_argument("--setup-oauth", action="store_true", help="OAuth-Authentifizierung einrichten")
    parser.add_argument("--setup-browser", action="store_true", help="Browser-Cookie-Authentifizierung einrichten")
    parser.add_argument("--port", type=int, default=PORT, help=f"Port (Standard: {PORT})")
    args = parser.parse_args()

    if args.setup_oauth:
        setup_oauth()
        sys.exit(0)

    if args.setup_browser:
        setup_browser()
        sys.exit(0)

    PORT = args.port
    init_ytmusic()
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"[OK] Kiyoshi Music Bridge läuft auf http://localhost:{PORT}")
    print(f"     Stoppen mit Ctrl+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Server gestoppt.")
