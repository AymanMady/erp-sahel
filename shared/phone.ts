/** Mauritanian phone numbers: 8 digits starting with 2, 3 or 4. */

export const PHONE_PATTERN = /^[234]\d{7}$/;

/** Removes spaces, dots and dashes typed by the user. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s.-]/g, "");
}

/** An empty phone is allowed (the field is optional). */
export function isValidPhone(value: string): boolean {
  const phone = normalizePhone(value);
  return phone === "" || PHONE_PATTERN.test(phone);
}
