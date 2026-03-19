# Kiyoshi Music 🎵

Ein privater YouTube Music Desktop-Client für Windows, gebaut mit Tauri + React.

## Voraussetzungen
- Node.js & Rust (bereits installiert)
- Python 3.10+
- YouTube Premium Account

## Einrichtung (einmalig)

### 1. Python-Abhängigkeiten
```bash
cd python-backend
pip install -r requirements.txt
```

### 2. YouTube-Account verknüpfen
```bash
python setup_auth.py
```
Ein Browser öffnet sich → einloggen → `oauth.json` wird erstellt.

### 3. Node-Abhängigkeiten
```bash
npm install
```

## App starten

**Terminal 1 (Backend):**
```bash
cd python-backend && python server.py
```

**Terminal 2 (App):**
```bash
npm run tauri dev
```

## Als .exe bauen
```bash
npm run tauri build
```
Ergebnis: `src-tauri/target/release/kiyoshi-music.exe`

## Hinweise
- Nur für privaten Gebrauch (inoffizielle API)
- `oauth.json` nicht teilen — enthält deine Anmeldedaten!
