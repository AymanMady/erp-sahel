/**
 * Briques communes à toutes les tables du schéma.
 *
 * Conventions non négociables (cf. `docs/ARCHITECTURE.md`) :
 *  - **UUID en clé primaire** partout ([NFR-DATA-1]) : le client hors-ligne génère ses
 *    propres identifiants, ils doivent être acceptables tels quels par le serveur.
 *  - **`company_id` sur toute entité tenant-scoped** ([BR-13]) : l'isolation est une
 *    colonne, pas une convention d'usage.
 *  - **Montants en centimes entiers**, **taux en points de base** (voir `shared/money.ts`).
 *  - **Soft-delete** via `is_active` sur les référentiels ; les documents comptables ne
 *    sont jamais supprimés ([BR-10], [NFR-DATA-2]).
 *  - **`client_uuid` unique** sur les entités synchronisables : c'est la clé d'idempotence
 *    qui garantit « synchronisé exactement une fois » ([BR-8]).
 */

import { boolean, integer, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** Horodatage de création/modification présent sur toutes les tables. */
export const auditTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Colonnes de base d'une entité : identité, horodatage, soft-delete. */
export const baseColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  ...auditTimestamps,
  isActive: boolean("is_active").default(true).notNull(),
};

/** Quantité stockée avec 3 décimales ; côté JS c'est une `string` (jamais un float). */
export const quantity = (name: string) => numeric(name, { precision: 16, scale: 3 });

/** Montant en centimes entiers. `bigint` non nécessaire : 2^31 centimes ≈ 21 M d'unités. */
export const moneyCents = (name: string) => integer(name);

/** Taux en points de base (16 % ⇒ 1600). */
export const rateBp = (name: string) => integer(name);

/**
 * Clé d'idempotence des opérations créées hors-ligne.
 * `null` pour les entités créées en ligne — la contrainte d'unicité partielle
 * (`WHERE client_uuid IS NOT NULL`) est posée dans la migration.
 */
export const clientUuid = () => uuid("client_uuid");
