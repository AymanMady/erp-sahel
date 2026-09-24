/**
 * Schéma de base de données complet — point d'entrée unique (`@shared/schema`).
 *
 * Organisation : un fichier par domaine. Toutes les tables sont exportées à plat, pour
 * que `drizzle-kit` les découvre.
 */

export * from "./_base";
export * from "./tenancy";
export * from "./accounts";
export * from "./plugins";
export * from "./numbering";
export * from "./catalog";
export * from "./parties";
export * from "./inventory";
export * from "./services";
export * from "./sales";
export * from "./purchasing";
export * from "./invoicing";
export * from "./banking";
export * from "./payments";
export * from "./pos";
export * from "./accounting";
export * from "./sync";
