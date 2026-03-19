/**
 * Kiyoshi Music — Internationalization (i18n)
 *
 * So fügt man eine neue Sprache hinzu:
 * 1. Kopiere den "de"-Block und ändere den Schlüssel (z.B. "fr" für Französisch)
 * 2. Übersetze alle Werte
 * 3. Füge die Sprache zur LANGUAGES-Liste hinzu
 *
 * Fehlende Schlüssel fallen automatisch auf Deutsch zurück.
 */

export const LANGUAGES = [
  {
    code: "de", label: "Deutsch",
    flag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3">
      <rect width="5" height="3" fill="#000"/>
      <rect width="5" height="2" y="1" fill="#D00"/>
      <rect width="5" height="1" y="2" fill="#FFCE00"/>
    </svg>`,
  },
  {
    code: "en", label: "English",
    flag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30">
      <rect width="60" height="30" fill="#012169"/>
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="4"/>
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" stroke-width="10"/>
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" stroke-width="6"/>
    </svg>`,
  },
  // Beispiel für neue Sprache:
  // {
  //   code: "fr", label: "Français",
  //   flag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2">
  //     <rect width="1" height="2" fill="#002395"/>
  //     <rect width="1" height="2" x="1" fill="#fff"/>
  //     <rect width="1" height="2" x="2" fill="#ED2939"/>
  //   </svg>`,
  // },
];

const translations = {

  // ─── Deutsch ────────────────────────────────────────────────────────────────
  de: {
    // Navigation
    home:             "Startseite",
    library:          "Bibliothek",
    likedSongs:       "Gelikte Songs",
    history:          "Verlauf",
    historyEmpty:     "Noch keine Songs gespielt.",
    clearHistory:     "Verlauf leeren",
    removeFromHistory: "Aus Verlauf entfernen",
    justNow:          "Gerade eben",
    search:           "Suchen...",
    pinned:           "Angepinnt",
    recentlyOpened:   "Zuletzt geöffnet",

    // Begrüßung
    goodMorning:      "Guten Morgen 🌅",
    goodNoon:         "Guten Mittag ☀️",
    goodAfternoon:    "Guten Nachmittag 🌤️",
    goodEvening:      "Guten Abend 🌙",
    goodNight:        "Gute Nacht 🌛",

    // Player
    selectSong:       "Wähle einen Song aus",
    loading:          "Lädt...",
    loadingDots:      "Lädt…",

    // Sammlungen
    playlist:         "Playlist",
    album:            "Album",
    artist:           "Künstler",
    songs:            "Songs",
    topSongs:         "Top Songs",
    albums:           "Alben",
    singles:          "Singles & EPs",
    back:             "Zurück",
    playAll:          "▶ Abspielen",
    likedTracks:      "Tracks",
    fetchingSongs:    "Songs werden abgerufen…",
    noPlaylists:      "Keine Playlists gefunden.",

    // Tabellen-Spalten
    colTitle:         "Titel",
    colArtist:        "Interpret",
    colAlbum:         "Album",
    colDuration:      "Dauer",

    // Suche
    searchPrompt:     "Tippe etwas ins Suchfeld und drücke Enter.",
    searchResultsFor: "Suchergebnisse für",
    noResults:        "Keine Ergebnisse gefunden.",
    filterSongs:      "Songs",
    filterArtists:    "Künstler",
    filterAlbums:     "Alben",
    filterPlaylists:  "Playlists",

    // Wiedergabeliste (Queue)
    queue:            "Wiedergabeliste",
    nowPlaying:       "Jetzt",
    upNext:           "Als nächstes",
    previouslyPlayed: "Zuvor gespielt",
    emptyQueue:       "Keine Songs in der Wiedergabeliste",
    clearQueue:       "Leeren",

    // Kontext-Menü
    pin:              "Anpinnen",
    unpin:            "Anpinnen entfernen",
    open:             "Öffnen",
    removeFromRecent: "Aus Verlauf entfernen",

    // Einstellungen — Allgemein
    appSettings:      "App-Einstellungen",
    settings:         "Einstellungen",
    close:            "Schließen",
    selectLanguage:   "Sprache auswählen",

    // Einstellungen — Tabs
    appearance:       "Darstellung",
    playback:         "Wiedergabe",
    lyrics:           "Lyrics",
    shortcuts:        "Tastenkürzel",
    language:         "Sprache",

    // Einstellungen — Darstellung
    theme:            "Theme",
    themeDark:        "Dark",
    themeOled:        "OLED",
    themeLight:       "Light",
    accentColor:      "Akzentfarbe",
    customColor:      "Eigene Farbe",
    animations:       "Animationen",
    animationsDesc:   "Übergänge, Bounce-Effekte, Equalizer",

    // Einstellungen — Wiedergabe
    autoplay:         "Autoplay",
    autoplayDesc:     "Nächsten Song automatisch abspielen",
    crossfade:        "Crossfade",
    crossfadeDesc:    "Überblendung zwischen Songs",
    discordRpc:       "Discord Rich Presence",
    discordRpcDesc:   "Zeigt den aktuellen Song in deinem Discord-Profil an",

    // Einstellungen — Lyrics
    fontSize:         "Schriftgröße",
    fontSizeDesc:     "Aktuelle Größe",
    lyricsProviders:     "Lyrics-Anbieter",
    lyricsProvidersDesc: "Reihenfolge und Aktivierung der Anbieter. Aktivierte Anbieter werden der Reihe nach versucht.",

    // Einstellungen — Cache
    cache:            "Cache",
    cacheAlbums:      "Alben",
    cachePlaylists:   "Playlists",
    cacheLyrics:      "Lyrics",
    cacheImages:      "Bilder",
    cacheEnabled:     "Aktiviert",
    cacheClear:       "Leeren",
    cacheClearAll:    "Alle leeren",
    cacheCleared:     "Geleert",
    cacheEmpty:       "Leer",
    cacheFiles:       "Dateien",
    cacheEntries:     "Einträge",

    // Einstellungen — Tastenkürzel
    shortcutsNote:    "Tastenkürzel funktionieren wenn kein Eingabefeld aktiv ist.",
    scPlayPause:      "Play / Pause",
    scNext:           "Nächster Song",
    scPrev:           "Vorheriger Song",
    scVolUp:          "Lautstärke +2%",
    scVolDown:        "Lautstärke -2%",
    scFullscreen:     "Vollbild toggle",
    scClose:          "Overlay schließen",

    // Login
    welcome:          "Willkommen",
    loginDesc:        "Verbinde dein YouTube Music Konto um deine Bibliothek zu nutzen.",
    loginButton:      "🔑 Bei YouTube Music anmelden",
    loginHint:        "Ein Browser-Fenster öffnet sich. Melde dich an – die App erkennt den Login automatisch.",
    loginWaiting:     "Warte auf Anmeldung…",
    loginWaitingDesc: "Melde dich im geöffneten Fenster bei YouTube Music an. Es schließt sich danach automatisch.",
    cancel:           "Abbrechen",
    loginSuccess:     "Anmeldung erfolgreich!",
    loginSuccessHint: "Die App wird geladen…",

    // Profile Switcher
    switchProfileTitle:       "Profil wechseln",
    addAccount:               "+ Konto hinzufügen",
    removeAccountTitle:       "Konto entfernen?",
    removeAccountDesc:        "Möchtest du dieses Konto wirklich entfernen? Diese Aktion kann nicht rückgängig gemacht werden.",
    removeAccountConfirm:     "Entfernen",

    // Sidebar
    expand:           "Ausklappen",
    noProfile:        "Kein Profil",
    switchProfile:    "Profil wechseln",

    // Lyrics
    lyricsLoading:    "Lyrics werden geladen…",
    noLyrics:         "Keine Lyrics verfügbar",
    noLyricsHint:     "Erstelle eigene Lyrics mit einem dieser Tools:",
    createLyrics:     "Lyrics erstellen",

    // Home / Suche / Views
    noSuggestions:    "Keine Vorschläge verfügbar.",
    loadingLikedSongs:"Lädt Liked Songs…",

    // Tooltips
    queueTooltip:     "Wiedergabeliste",
    lyricsTooltip:    "Lyrics",
    fullscreenTooltip:"Vollbild",
    single:           "Single",

    // Playlist-Verwaltung
    newPlaylist:          "Neue Playlist",
    createPlaylist:       "Playlist erstellen",
    playlistTitle:        "Titel",
    playlistDescription:  "Beschreibung",
    playlistPrivacy:      "Sichtbarkeit",
    privacyPrivate:       "Privat",
    privacyPublic:        "Öffentlich",
    privacyUnlisted:      "Nicht gelistet",
    create:               "Erstellen",
    addToPlaylist:        "Zu Playlist hinzufügen",
    removeFromPlaylist:   "Aus Playlist entfernen",
    deletePlaylist:       "Playlist löschen",
    deletePlaylistConfirm:"Playlist wirklich löschen?",
    renamePlaylist:       "Playlist umbenennen",
    playlistCreated:      "Playlist erstellt",
    trackAdded:           "Song hinzugefügt",
    trackRemoved:         "Song entfernt",

    // Offline-Playback
    removeDownload:       "Download entfernen",
    download:             "Herunterladen",
    downloaded:           "Heruntergeladen",
    downloading:          "Wird heruntergeladen…",
    downloadAll:          "Alle herunterladen",
    cacheSongs:           "Songs",
    offlineAvailable:     "Offline verfügbar",

    // Player — More Dropdown
    goToAlbum:            "Zum Album",
    goToArtist:           "Zum Künstler",
    refetchLyrics:        "Lyrics neu laden",

    // Downloads / MP3 Export
    downloads:            "Downloads",
    saveAsMp3:            "Als MP3 speichern",
    saveAsOpus:           "Als OPUS speichern",
    exportStarted:        "Export gestartet…",
    exportDone:           "Erfolgreich gespeichert!",
    exportError:          "Export fehlgeschlagen.",
    noFfmpeg:             "FFmpeg nicht gefunden. Installiere FFmpeg für MP3-Export.",
    defaultSavePath:      "Standard-Speicherort",
    changePath:           "Pfad ändern",
    resetPath:            "Zurücksetzen",
    maxCacheSize:         "Max. Cache-Größe",
    unlimited:            "Unbegrenzt",
    cacheWarning:         "Speicherwarnung",
    exporting:            "Wird exportiert…",
    exported:             "Exportiert",
    noPathSet:            "Nicht festgelegt",
    songsCount:           "Songs",
    storageUsed:          "Speicherverbrauch",

    // Update Checker
    update:               "Update",
    updateAvailable:      "Update verfügbar",
    upToDate:             "Kiyoshi Music ist auf dem neuesten Stand",
    currentVersion:       "Aktuelle Version",
    latestVersion:        "Neueste Version",
    changelog:            "Änderungen",
    downloadUpdate:       "Update herunterladen",
    released:             "Veröffentlicht",
    checkForUpdates:      "Nach Updates suchen",
    checking:             "Prüfe…",

    // Playlist / Album
    totalDuration:     "Gesamtdauer",
    searchInPlaylist:  "In Playlist suchen…",
    xOfY:              "von",

    // Explicit Content
    hideExplicit:      "Explizite Inhalte ausblenden",
    hideExplicitDesc:  'Songs mit dem "E"-Badge werden nicht angezeigt',

    // UI-Zoom
    uiZoom:            "Zoom",
    uiZoomDesc:        "Skalierung der Oberfläche",

    // LRC-Buttons
    copyLyrics:        "Lyrics kopieren",
    saveLrc:           "Als .lrc speichern",
    lyricsCopied:      "Lyrics in Zwischenablage kopiert!",
    lrcSaved:          "LRC gespeichert!",

    // Fehler
    errorLoading:     "Fehler beim Laden",
    backendHint:      "Läuft das Python-Backend?",
  },

  // ─── English ────────────────────────────────────────────────────────────────
  en: {
    home:             "Home",
    library:          "Library",
    likedSongs:       "Liked Songs",
    history:          "History",
    historyEmpty:     "No songs played yet.",
    clearHistory:     "Clear history",
    removeFromHistory: "Remove from history",
    justNow:          "Just now",
    search:           "Search...",
    pinned:           "Pinned",
    recentlyOpened:   "Recently Opened",

    goodMorning:      "Good Morning 🌅",
    goodNoon:         "Good Noon ☀️",
    goodAfternoon:    "Good Afternoon 🌤️",
    goodEvening:      "Good Evening 🌙",
    goodNight:        "Good Night 🌛",

    selectSong:       "Select a song",
    loading:          "Loading...",
    loadingDots:      "Loading…",

    playlist:         "Playlist",
    album:            "Album",
    artist:           "Artist",
    songs:            "Songs",
    topSongs:         "Top Songs",
    albums:           "Albums",
    singles:          "Singles & EPs",
    back:             "Back",
    playAll:          "▶ Play",
    likedTracks:      "Tracks",
    fetchingSongs:    "Fetching songs…",
    noPlaylists:      "No playlists found.",

    colTitle:         "Title",
    colArtist:        "Artist",
    colAlbum:         "Album",
    colDuration:      "Duration",

    searchPrompt:     "Type something and press Enter.",
    searchResultsFor: "Search results for",
    noResults:        "No results found.",
    filterSongs:      "Songs",
    filterArtists:    "Artists",
    filterAlbums:     "Albums",
    filterPlaylists:  "Playlists",

    queue:            "Queue",
    nowPlaying:       "Now Playing",
    upNext:           "Up Next",
    previouslyPlayed: "Previously Played",
    emptyQueue:       "No songs in queue",
    clearQueue:       "Clear",

    pin:              "Pin",
    unpin:            "Unpin",
    open:             "Open",
    removeFromRecent: "Remove from history",

    appSettings:      "App Settings",
    settings:         "Settings",
    close:            "Close",
    selectLanguage:   "Select Language",

    appearance:       "Appearance",
    playback:         "Playback",
    lyrics:           "Lyrics",
    shortcuts:        "Shortcuts",
    language:         "Language",

    theme:            "Theme",
    themeDark:        "Dark",
    themeOled:        "OLED",
    themeLight:       "Light",
    accentColor:      "Accent Color",
    customColor:      "Custom Color",
    animations:       "Animations",
    animationsDesc:   "Transitions, bounce effects, equalizer",

    autoplay:         "Autoplay",
    autoplayDesc:     "Automatically play next song",
    crossfade:        "Crossfade",
    crossfadeDesc:    "Crossfade between songs",
    discordRpc:       "Discord Rich Presence",
    discordRpcDesc:   "Show current song in your Discord profile",

    fontSize:         "Font Size",
    fontSizeDesc:     "Current size",
    lyricsProviders:     "Lyrics Providers",
    lyricsProvidersDesc: "Order and activation of providers. Enabled providers are tried in order.",

    // Settings — Cache
    cache:            "Cache",
    cacheAlbums:      "Albums",
    cachePlaylists:   "Playlists",
    cacheLyrics:      "Lyrics",
    cacheImages:      "Images",
    cacheEnabled:     "Enabled",
    cacheClear:       "Clear",
    cacheClearAll:    "Clear All",
    cacheCleared:     "Cleared",
    cacheEmpty:       "Empty",
    cacheFiles:       "files",
    cacheEntries:     "entries",

    shortcutsNote:    "Shortcuts work when no input field is active.",
    scPlayPause:      "Play / Pause",
    scNext:           "Next Song",
    scPrev:           "Previous Song",
    scVolUp:          "Volume +2%",
    scVolDown:        "Volume -2%",
    scFullscreen:     "Fullscreen toggle",
    scClose:          "Close overlay",

    // Login
    welcome:          "Welcome",
    loginDesc:        "Connect your YouTube Music account to use your library.",
    loginButton:      "🔑 Sign in to YouTube Music",
    loginHint:        "A browser window will open. Sign in — the app detects your login automatically.",
    loginWaiting:     "Waiting for login…",
    loginWaitingDesc: "Sign in to YouTube Music in the opened window. It will close automatically.",
    cancel:           "Cancel",
    loginSuccess:     "Login successful!",
    loginSuccessHint: "Loading the app…",

    // Profile Switcher
    switchProfileTitle:       "Switch Profile",
    addAccount:               "+ Add Account",
    removeAccountTitle:       "Remove Account?",
    removeAccountDesc:        "Are you sure you want to remove this account? This action cannot be undone.",
    removeAccountConfirm:     "Remove",

    // Sidebar
    expand:           "Expand",
    noProfile:        "No Profile",
    switchProfile:    "Switch Profile",

    // Lyrics
    lyricsLoading:    "Loading lyrics…",
    noLyrics:         "No lyrics available",
    noLyricsHint:     "Create your own lyrics with one of these tools:",
    createLyrics:     "Create Lyrics",

    // Home / Search / Views
    noSuggestions:    "No suggestions available.",
    loadingLikedSongs:"Loading Liked Songs…",

    // Tooltips
    queueTooltip:     "Queue",
    lyricsTooltip:    "Lyrics",
    fullscreenTooltip:"Fullscreen",
    single:           "Single",

    // Playlist Management
    newPlaylist:          "New Playlist",
    createPlaylist:       "Create Playlist",
    playlistTitle:        "Title",
    playlistDescription:  "Description",
    playlistPrivacy:      "Privacy",
    privacyPrivate:       "Private",
    privacyPublic:        "Public",
    privacyUnlisted:      "Unlisted",
    create:               "Create",
    addToPlaylist:        "Add to Playlist",
    removeFromPlaylist:   "Remove from Playlist",
    deletePlaylist:       "Delete Playlist",
    deletePlaylistConfirm:"Really delete this playlist?",
    renamePlaylist:       "Rename Playlist",
    playlistCreated:      "Playlist created",
    trackAdded:           "Song added",
    trackRemoved:         "Song removed",

    // Offline Playback
    removeDownload:       "Remove Download",
    download:             "Download",
    downloaded:           "Downloaded",
    downloading:          "Downloading…",
    downloadAll:          "Download All",
    cacheSongs:           "Songs",
    offlineAvailable:     "Available offline",

    // Player — More Dropdown
    goToAlbum:            "Go to Album",
    goToArtist:           "Go to Artist",
    refetchLyrics:        "Refetch Lyrics",

    // Downloads / MP3 Export
    downloads:            "Downloads",
    saveAsMp3:            "Save as MP3",
    saveAsOpus:           "Save as OPUS",
    exportStarted:        "Export started…",
    exportDone:           "Successfully saved!",
    exportError:          "Export failed.",
    noFfmpeg:             "FFmpeg not found. Install FFmpeg to use MP3 export.",
    defaultSavePath:      "Default save path",
    changePath:           "Change path",
    resetPath:            "Reset",
    maxCacheSize:         "Max. cache size",
    unlimited:            "Unlimited",
    cacheWarning:         "Storage warning",
    exporting:            "Exporting…",
    exported:             "Exported",
    noPathSet:            "Not set",
    songsCount:           "Songs",
    storageUsed:          "Storage used",

    // Update Checker
    update:               "Update",
    updateAvailable:      "Update available",
    upToDate:             "Kiyoshi Music is up to date",
    currentVersion:       "Current version",
    latestVersion:        "Latest version",
    changelog:            "Changelog",
    downloadUpdate:       "Download update",
    released:             "Released",
    checkForUpdates:      "Check for updates",
    checking:             "Checking…",

    // Playlist / Album
    totalDuration:     "Total Duration",
    searchInPlaylist:  "Search in playlist…",
    xOfY:              "of",

    // Explicit Content
    hideExplicit:      "Hide Explicit Content",
    hideExplicitDesc:  "Songs with the \"E\" badge will be hidden",

    // UI-Zoom
    uiZoom:            "Zoom",
    uiZoomDesc:        "User interface scaling",

    // LRC Buttons
    copyLyrics:        "Copy Lyrics",
    saveLrc:           "Save as .lrc",
    lyricsCopied:      "Lyrics copied to clipboard!",
    lrcSaved:          "LRC saved!",

    errorLoading:     "Error loading",
    backendHint:      "Is the Python backend running?",
  },

};

/**
 * Gibt die Übersetzung für einen Schlüssel zurück.
 * Fallback: Deutsch → Schlüssel selbst
 */
export function translate(lang, key) {
  return translations[lang]?.[key] ?? translations.de[key] ?? key;
}

export default translations;
