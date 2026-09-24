/**
 * UI internationalization (i18next).
 *
 * Translations live in `locales/<language>/<namespace>.json` and are bundled
 * eagerly: the app must work offline, so nothing is fetched at runtime. Adding a
 * namespace only takes a new JSON file per language.
 *
 * The chosen language is stored on the device, sets `<html lang dir>` (Arabic is
 * right-to-left), drives the shared number/date formatters and is sent to the API
 * in `Accept-Language` so server messages come back in the same language.
 */

import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

import { setFormatLocaleResolver } from "@shared/intl";
import {
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGES,
  isLanguageCode,
  languageInfo,
  type LanguageCode,
  type TextDirection,
} from "./languages";

export * from "./languages";

const STORAGE_KEY = "erp.language";

const modules = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json", {
  eager: true,
});

function buildResources(): Resource {
  const resources: Resource = {};
  for (const [path, module] of Object.entries(modules)) {
    const match = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, language, namespace] = match;
    resources[language] ??= {};
    resources[language][namespace] = module.default;
  }
  return resources;
}

function readStoredLanguage(): LanguageCode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguageCode(stored) ? stored : null;
  } catch {
    return null;
  }
}

function detectLanguage(): LanguageCode {
  const stored = readStoredLanguage();
  if (stored) return stored;
  if (typeof navigator !== "undefined") {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag?.split("-")[0];
      if (isLanguageCode(base)) return base;
    }
  }
  return DEFAULT_LANGUAGE;
}

function applyDocumentLanguage(code: string): void {
  if (typeof document === "undefined") return;
  const info = languageInfo(code);
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
}

const resources = buildResources();

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES.map((language) => language.code),
  ns: Object.keys(resources[FALLBACK_LANGUAGE] ?? { common: {} }),
  defaultNS: "common",
  fallbackNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

setFormatLocaleResolver(() => languageInfo(i18n.language).intl);

export function currentLanguage(): LanguageCode {
  return isLanguageCode(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export function currentDirection(): TextDirection {
  return languageInfo(i18n.language).dir;
}

/** `Intl` locale of the UI language, for ad-hoc `Intl.NumberFormat`/`DateTimeFormat`. */
export function currentIntlLocale(): string {
  return languageInfo(i18n.language).intl;
}

export async function changeLanguage(code: LanguageCode): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage unavailable (private mode): the choice only lasts for this session.
  }
  await i18n.changeLanguage(code);
}

export { i18n };
