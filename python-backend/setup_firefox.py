"""
Kiyoshi Music - Setup via Firefox Headers
Fuehre aus: python setup_firefox.py
"""
import ytmusicapi, sys

print("=== Kiyoshi Music - Firefox Header Setup ===")
print()
print("Fuege die kopierten Request-Header ein.")
print("Wenn fertig: Enter druecken, dann Strg+Z, dann nochmal Enter")
print()

lines = []
try:
    while True:
        lines.append(input())
except EOFError:
    pass

raw = "\n".join(lines).strip()
if not raw:
    print("[!] Keine Eingabe. Abbruch.")
    sys.exit(1)

if "cookie" not in raw.lower():
    print("[!] Kein Cookie gefunden im kopierten Text.")
    print("    Stelle sicher dass du die Header aus Firefox kopiert hast")
    print("    und einen POST /browse Request ausgewaehlt hast.")
    sys.exit(1)

print("\nVerarbeite...")
try:
    ytmusicapi.setup(filepath="browser.json", headers_raw=raw)
    print("Fertig! browser.json erstellt.")
    print("Starte jetzt: python server.py")
except Exception as e:
    print(f"[!] Fehler: {e}")
    sys.exit(1)
