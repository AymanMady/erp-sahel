/** Languages offered by the UI. */

export const LANGUAGES = [
  { code: "fr", label: "Français", dir: "ltr", intl: "fr-FR" },
  // Latin digits: the usual convention for prices and quantities in the Maghreb/Sahel.
  { code: "ar", label: "العربية", dir: "rtl", intl: "ar-u-nu-latn" },
  { code: "en", label: "English", dir: "ltr", intl: "en-GB" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type TextDirection = "ltr" | "rtl";

export const DEFAULT_LANGUAGE: LanguageCode = "fr";
export const FALLBACK_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

export function languageInfo(code: string) {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}
