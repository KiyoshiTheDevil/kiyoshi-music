@echo off
echo === Kiyoshi Music - Server Build ===
echo.

REM Install PyInstaller and dependencies if needed
pip install pyinstaller yt-dlp pykakasi --quiet

REM Build the server executable with the correct Tauri platform suffix
echo Kompiliere server.py...
pyinstaller --onefile ^
  --name kiyoshi-server-x86_64-pc-windows-msvc ^
  --distpath ..\src-tauri\binaries ^
  --workpath .\build_tmp ^
  --specpath .\build_tmp ^
  --hidden-import=ytmusicapi ^
  --hidden-import=flask ^
  --hidden-import=flask_cors ^
  --hidden-import=yt_dlp ^
  --hidden-import=pykakasi ^
  --collect-all ytmusicapi ^
  --collect-all yt_dlp ^
  --collect-all pykakasi ^
  --add-data "%LOCALAPPDATA%\Programs\Python\Python313\Lib\site-packages\ytmusicapi\locales;ytmusicapi/locales" ^
  server.py

echo.
if exist "..\src-tauri\binaries\kiyoshi-server-x86_64-pc-windows-msvc.exe" (
    echo Erfolgreich! kiyoshi-server-x86_64-pc-windows-msvc.exe wurde erstellt.
) else (
    echo FEHLER: Die .exe wurde nicht erstellt!
)
echo Jetzt kannst du "npm run tauri build" ausfuehren.
pause
