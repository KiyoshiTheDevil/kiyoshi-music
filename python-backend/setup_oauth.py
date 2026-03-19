"""
Kiyoshi Music - OAuth Login (Alternative zu Header-Methode)
Fuehre aus: python setup_oauth.py
"""
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth import OAuthCredentials
import sys

print("=== Kiyoshi Music - OAuth Login ===")
print()
print("Diese Methode oeffnet einen Browser-Link zur Google-Anmeldung.")
print()

try:
    YTMusic.setup_oauth(filepath="oauth.json", open_browser=True)
    print("\nFertig! oauth.json wurde erstellt.")
    print("Starte jetzt: python server.py")
except AttributeError:
    print("[!] setup_oauth nicht verfuegbar in dieser Version.")
    print()
    print("Bitte fuehre stattdessen direkt aus:")
    print("  python -c \"from ytmusicapi import YTMusic; YTMusic.setup(filepath='oauth.json')\"")
except Exception as e:
    print(f"[!] Fehler: {e}")
    sys.exit(1)
