"""
Kiyoshi Music - Manuelles Cookie-Setup
Sammelt alle nötigen Cookies und berechnet Authorization automatisch.
"""
import json, hashlib, time, os

print("=== Kiyoshi Music - Cookie Setup ===")
print()
print("Oeffne F12 -> Anwendung -> Cookies -> https://music.youtube.com")
print("und gib folgende Werte ein (leer lassen wenn nicht vorhanden):")
print()

cookies = {}
for name in ["SID", "SSID", "SAPISID", "__Secure-3PSID", "__Secure-3PAPISID", "HSID"]:
    val = input(f"  {name}: ").strip()
    if val:
        cookies[name] = val

print()
sapisid = cookies.get("SAPISID", "")
if not sapisid:
    print("[!] SAPISID fehlt - Authorization kann nicht berechnet werden.")
    exit(1)

def sapisidhash(sapisid):
    ts = str(int(time.time()))
    origin = "https://music.youtube.com"
    h = hashlib.sha1(f"{ts} {sapisid} {origin}".encode()).hexdigest()
    return f"SAPISIDHASH {ts}_{h}"

auth = sapisidhash(sapisid)
cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())

browser_json = {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "de-DE,de;q=0.9",
    "Authorization": auth,
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
print(f"Authorization berechnet: {auth[:50]}...")
print(f"Cookies gesetzt: {list(cookies.keys())}")
print()
print("Fertig! browser.json wurde aktualisiert.")
print("Starte jetzt: python server.py")
