/** Formatage commun (dates, identifiants, libellés) — français par défaut. */

/** `YYYY-MM-DD` en heure locale (les colonnes `date` de Postgres ne portent pas de fuseau). */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** Date du jour au format attendu par un `<input type="date">`. */
export function todayInput(): string {
  return toDateInput(new Date());
}

/** Ajoute N jours à une date `YYYY-MM-DD` (échéance = date + conditions de paiement). */
export function addDays(dateInput: string, days: number): string {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

export function formatDate(value: Date | string | null | undefined, locale = "fr-FR"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined, locale = "fr-FR"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Initiales pour les avatars (« Ahmed Ould Salem » ⇒ « AO »). */
export function initials(value: string | null | undefined): string {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Identifiant technique dérivé d'un libellé (codes tiers, slugs de rôle). */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
