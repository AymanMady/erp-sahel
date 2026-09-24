/**
 * Complete database schema — single entry point (`@shared/schema`).
 *
 * Layout: one file per domain. All tables are re-exported flat so that `drizzle-kit`
 * discovers them.
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
