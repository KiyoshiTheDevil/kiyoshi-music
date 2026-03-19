/**
 * Kiyoshi Music — Internationalization (i18n)
 *
 * Translations are stored as JSON files in src/locales/.
 * To add a new language:
 * 1. Create src/locales/<code>.json (copy en.json and translate all values)
 * 2. Add the language metadata (code, label, flag SVG) to src/locales/languages.json
 *
 * The app automatically picks up any new locale file — no code changes needed.
 * Missing keys fall back to English, then to the key itself.
 */

import languageList from "./locales/languages.json";

// Auto-load all locale JSON files from src/locales/ (except languages.json)
const localeModules = import.meta.glob("./locales/*.json", { eager: true });

const translations = {};
for (const [path, module] of Object.entries(localeModules)) {
  const code = path.match(/\/(\w+)\.json$/)?.[1];
  if (code && code !== "languages") {
    translations[code] = module.default;
  }
}

// Only expose languages that actually have a translation file loaded
export const LANGUAGES = languageList.filter((lang) => translations[lang.code]);

/**
 * Returns the translation for a key.
 * Fallback order: selected language → English → key itself
 */
export function translate(lang, key) {
  return translations[lang]?.[key] ?? translations.en?.[key] ?? key;
}

export default translations;
