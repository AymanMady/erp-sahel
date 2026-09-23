/**
 * Connexion PostgreSQL et instance Drizzle partagées par tout le serveur.
 *
 * Un seul pool pour le processus : les repositories reçoivent soit `db`, soit le
 * `tx` d'une transaction en cours (type `Database`), ce qui permet à une application
 * d'enchaîner plusieurs repositories **dans la même transaction** — indispensable pour
 * « facture + stock + écriture comptable, ou rien » ([BR-6], [BR-7]).
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "@shared/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL est absent. Copiez .env.example vers .env puis renseignez la chaîne PostgreSQL."
  );
}

/**
 * `numeric` est renvoyé en `string` par `pg` pour préserver la précision. On garde ce
 * comportement : les quantités transitent en chaîne et ne sont converties qu'au calcul
 * (`normalizeQuantity`). Les montants, eux, sont des entiers — aucun risque.
 */
export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("[db] erreur inattendue du pool PostgreSQL", error);
});

export const db = drizzle(pool, { schema });

/** Type accepté par les repositories : le pool, ou une transaction en cours. */
export type Database = NodePgDatabase<typeof schema>;

/** Exécute un bloc dans une transaction ; toute exception provoque le rollback. */
export async function runInTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as Database));
}

/** Reconnaît une panne de connectivité pour répondre 503 plutôt que 500. */
export function isDatabaseConnectivityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "57P01" || // admin_shutdown
    code === "57P03" || // cannot_connect_now
    code === "08006" || // connection_failure
    code === "08001"
  );
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
