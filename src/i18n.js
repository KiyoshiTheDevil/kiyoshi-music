/**
 * Kiyoshi Music — Internationalization (i18n)
 *
 * Translations are stored as JSON files in src/locales/.
 * To add a new language:
 * 1. Create src/locales/<code>.json (copy en.json and translate all values)
 * 2. Add the language to the LANGUAGES list below
 *
 * Missing keys fall back to English, then to the key itself.
 */

import en from "./locales/en.json";
import de from "./locales/de.json";

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
  // To add a new language, add an entry here and create src/locales/<code>.json
  // Example:
  // {
  //   code: "fr", label: "Français",
  //   flag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2">
  //     <rect width="1" height="2" fill="#002395"/>
  //     <rect width="1" height="2" x="1" fill="#fff"/>
  //     <rect width="1" height="2" x="2" fill="#ED2939"/>
  //   </svg>`,
  // },
];

const translations = { en, de };

/**
 * Returns the translation for a key.
 * Fallback order: selected language → English → key itself
 */
export function translate(lang, key) {
  return translations[lang]?.[key] ?? translations.en[key] ?? key;
}

export default translations;
