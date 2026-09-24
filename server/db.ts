/**
 * PostgreSQL connection and Drizzle instance shared by the whole server.
 *
 * A single pool per process: repositories receive either `db` or the `tx` of an
 * ongoing transaction (type `Database`), which lets an application chain several
 * repositories **within the same transaction** — essential for "invoice + stock +
 * journal entry, or nothing" ([BR-6], [BR-7]).
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "@shared/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and fill in the PostgreSQL connection string."
  );
}

/**
 * `numeric` is returned as a `string` by `pg` to preserve precision. We keep that
 * behavior: quantities travel as strings and are only converted when computing
 * (`normalizeQuantity`). Amounts are integers — no risk there.
 */
export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("[db] unexpected PostgreSQL pool error", error);
});

export const db = drizzle(pool, { schema });

/** Type accepted by repositories: the pool, or an ongoing transaction. */
export type Database = NodePgDatabase<typeof schema>;

/** Runs a block in a transaction; any exception triggers a rollback. */
export async function runInTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as Database));
}

/** Detects a connectivity failure to answer 503 rather than 500. */
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
