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
/**
 * Amounts and sums are `bigint` in the database (a shop's yearly sales exceed the
 * 21 million MRU an `integer` holds). `pg` returns `bigint` as a string by default: it
 * is read as a number here, exact up to 90 000 billion MRU.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  // A serverless database (Neon) suspended after inactivity takes a few seconds to
  // wake up: give it time rather than failing the first request of the morning.
  connectionTimeoutMillis: 15_000,
  // Keeps idle connections alive through proxies and NATs that silently drop them.
  keepAlive: true,
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

/**
 * Messages `pg` uses for a connection lost or never obtained. They carry no `code`:
 * typically a connection closed by the database while the serverless instance was
 * frozen, then reused on the next request.
 */
const CONNECTIVITY_MESSAGES = [
  "Connection terminated",
  "timeout exceeded when trying to connect",
  "Client has encountered a connection error",
  "Connection ended unexpectedly",
];

/**
 * Detects a connectivity failure to answer 503 rather than 500: the client then
 * knows it is temporary, retries a read and falls back on its local data.
 */
export function isDatabaseConnectivityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "57P01" || // admin_shutdown
    code === "57P03" || // cannot_connect_now
    code === "08006" || // connection_failure
    code === "08001" ||
    code === "08003" // connection_does_not_exist
  ) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && CONNECTIVITY_MESSAGES.some((m) => message.includes(m))) {
    return true;
  }
  // Drizzle wraps driver errors: look at the original one.
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error && isDatabaseConnectivityError(cause);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
