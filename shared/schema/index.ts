/**
 * Schéma de base de données complet — point d'entrée unique (`@shared/schema`).
 *
 * Organisation : un fichier par domaine du noyau, un fichier par module métier dans
 * `modules/`. Le noyau n'importe jamais `modules/*` ailleurs qu'ici ([BR-17]) : ce
 * barrel est le seul endroit où les deux mondes se rencontrent, pour que `drizzle-kit`
 * voie toutes les tables.
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

// Réexport à plat (et non en namespace) : `drizzle-kit` ne découvre que les tables
// exportées au premier niveau du fichier de schéma. Les noms des modules sont préfixés
// (`ap_`, `cl_`, `mk_` côté SQL) — aucune collision possible avec le noyau.
export * from "./modules/auto-parts";
export * from "./modules/clothing";
export * from "./modules/market";
