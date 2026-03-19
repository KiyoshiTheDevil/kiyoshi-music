"""
Kiyoshi Music - Authentifizierung (manuell via browser.json)
Fuehre aus: python setup_auth.py
"""
import json, sys, os

print("=== Kiyoshi Music - Authentifizierung ===")
print()
print("Wir erstellen browser.json direkt aus deinen Cookies.")
print()
print("--- Schritt 1: Cookie holen ---")
print("1. Oeffne https://music.youtube.com in Chrome (eingeloggt!)")
print("2. Druecke F12 -> Tab 'Anwendung' (Application)")
print("3. Links: Cookies -> https://music.youtube.com")
print("4. Suche den Eintrag '__Secure-3PSID' und kopiere seinen Wert")
print()
cookie_3psid = input("Wert von __Secure-3PSID: ").strip()

print()
print("5. Suche den Eintrag '__Secure-3PAPISID' und kopiere seinen Wert")
cookie_3papisid = input("Wert von __Secure-3PAPISID: ").strip()

print()
print("--- Schritt 2: Authorization-Header holen ---")
print("1. Wechsle zu Tab 'Netzwerk'")
print("2. Im Filterfeld: '/browse' eingeben")
print("3. Klicke in YouTube Music auf 'Bibliothek'")
print("4. Klicke auf einen POST-Request (browse?, Status 200)")
print("5. Rechts -> 'Header' -> 'Anforderungsheader'")
print("6. Suche die Zeile 'authorization:' und kopiere den kompletten Wert")
print("   (faengt mit 'SAPISIDHASH' an)")
print()
authorization = input("Wert von authorization: ").strip()

if not cookie_3psid or not authorization:
    print("\n[!] Fehlende Eingaben. Bitte nochmal versuchen.")
    sys.exit(1)

cookie_str = f"__Secure-3PSID={cookie_3psid}; __Secure-3PAPISID={cookie_3papisid}"

browser_json = {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "de-DE,de;q=0.9",
    "Authorization": authorization,
    "Content-Type": "application/json",
    "Cookie": cookie_str,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Goog-AuthUser": "0",
    "x-origin": "https://music.youtube.com"
}

out = os.path.join(os.path.dirname(__file__), "browser.json")
with open(out, "w") as f:
    json.dump(browser_json, f, indent=2)

print()
print("Fertig! browser.json wurde erstellt.")
print("Starte jetzt: python server.py")
