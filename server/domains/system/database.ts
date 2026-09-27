/**
 * Technical management of the database, for the super-administrator only: overview,
 * full backup, full restore and maintenance.
 *
 * A backup is one gzip-compressed JSON file holding every row of every table of the
 * `public` schema, read in a single snapshot (a sale recorded meanwhile is either
 * entirely in the file or not at all). Sessions and sign-in counters are left out:
 * they are only valid on the server that issued them.
 *
 * A restore **replaces** the whole database, in one transaction: foreign keys are
 * dropped, every table emptied and refilled, then the keys are put back — which checks
 * every link of the restored data. Any problem cancels everything and the database is
 * left as it was.
 */

import { gunzipSync, createGzip } from "node:zlib";
import os from "node:os";
import type { Writable } from "node:stream";

import type { PoolClient } from "pg";

import { pool } from "../../db";
import { BusinessRuleError, ValidationError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { authRepository } from "../auth/repository";
import { invalidateAllSessionStates } from "../auth/guards";
import { ensureSuperAdmin } from "./super-admin";

const BACKUP_FORMAT = "erp-sahel-backup";
const BACKUP_VERSION = 1;

/** Only valid on the server that issued them: never saved nor restored. */
const TRANSIENT_TABLES = new Set(["refresh_tokens", "rate_limit_hits"]);

/** Rows sent per insert statement during a restore. */
const RESTORE_CHUNK = 2_000;

interface BackupFile {
  format: string;
  version: number;
  createdAt: string;
  /** Last applied migration when the backup was made (`null`: unknown). */
  schemaVersion: string | null;
  tables: Record<string, unknown[]>;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function listTables(client: { query: PoolClient["query"] }): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by tablename"
  );
  return rows.map((row) => row.name);
}

/**
 * Last migration applied by `npm run db:migrate`. A database set up with
 * `drizzle-kit push` has no journal: `null`.
 */
async function schemaVersion(client: { query: PoolClient["query"] }): Promise<string | null> {
  try {
    const { rows } = await client.query<{ hash: string }>(
      "select hash from drizzle.__drizzle_migrations order by created_at desc limit 1"
    );
    return rows[0]?.hash ?? null;
  } catch {
    return null;
  }
}

/** State of the server and of the database, for the database screen. */
export async function databaseOverview() {
  const client = await pool.connect();
  try {
    const [info, tables, migrations, sessions, users, companies] = await Promise.all([
      client.query<{ version: string; name: string; size: number }>(
        `select version() as version, current_database() as name,
                pg_database_size(current_database()) as size`
      ),
      client.query<{ name: string; size: number }>(
        `select c.relname as name, pg_total_relation_size(c.oid) as size
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`
      ),
      client
        .query<{ count: number; last: Date | null }>(
          "select count(*)::int as count, max(to_timestamp(created_at / 1000.0)) as last from drizzle.__drizzle_migrations"
        )
        .catch(() => null),
      client.query<{ count: number }>(
        "select count(*)::int as count from refresh_tokens where revoked_at is null and expires_at > now()"
      ),
      client.query<{ count: number }>(
        "select count(*)::int as count from users where not is_superuser"
      ),
      client.query<{ count: number }>("select count(*)::int as count from companies"),
    ]);

    // Exact row counts: a shop's database is small enough for `count(*)` on each table.
    const rowCounts = new Map<string, number>();
    for (const table of tables.rows) {
      const { rows } = await client.query<{ count: number }>(
        `select count(*)::int as count from ${quoteIdent(table.name)}`
      );
      rowCounts.set(table.name, rows[0]?.count ?? 0);
    }

    return {
      server: {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV ?? "development",
        platform: `${os.type()} ${os.release()}`,
        uptimeSeconds: Math.round(process.uptime()),
        memoryBytes: process.memoryUsage().rss,
      },
      database: {
        name: info.rows[0]?.name ?? "",
        version: (info.rows[0]?.version ?? "").split(" on ")[0],
        sizeBytes: Number(info.rows[0]?.size ?? 0),
        migrations: migrations?.rows[0]?.count ?? null,
        lastMigrationAt: migrations?.rows[0]?.last ?? null,
      },
      counts: {
        activeSessions: sessions.rows[0]?.count ?? 0,
        users: users.rows[0]?.count ?? 0,
        companies: companies.rows[0]?.count ?? 0,
      },
      tables: tables.rows
        .map((table) => ({
          name: table.name,
          rows: rowCounts.get(table.name) ?? 0,
          sizeBytes: Number(table.size),
        }))
        .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name)),
    };
  } finally {
    client.release();
  }
}

/**
 * Writes a full backup (gzip JSON) to `output`. Each table is turned into JSON by
 * PostgreSQL itself and copied as text: the server never holds the whole database in
 * memory at once, only one table.
 */
export async function writeBackup(output: Writable): Promise<void> {
  const client = await pool.connect();
  const gzip = createGzip();
  gzip.pipe(output);
  const write = (chunk: string) =>
    new Promise<void>((resolve, reject) => {
      gzip.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  try {
    // One consistent picture of the whole database.
    await client.query("begin isolation level repeatable read read only");
    const version = await schemaVersion(client);
    await write(
      `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},` +
        `"createdAt":${JSON.stringify(new Date().toISOString())},` +
        `"schemaVersion":${JSON.stringify(version)},"tables":{`
    );
    const tables = (await listTables(client)).filter((name) => !TRANSIENT_TABLES.has(name));
    for (const [index, name] of tables.entries()) {
      const { rows } = await client.query<{ data: string }>(
        `select coalesce(json_agg(t), '[]'::json)::text as data from ${quoteIdent(name)} t`
      );
      await write(`${index > 0 ? "," : ""}${JSON.stringify(name)}:${rows[0].data}`);
    }
    await write("}}");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    gzip.destroy(error as Error);
    throw error;
  } finally {
    client.release();
  }
  gzip.end();
}

/** Reads an uploaded backup (gzip or plain JSON) and checks its envelope. */
function parseBackup(file: Buffer): BackupFile {
  let text: string;
  try {
    const isGzip = file.length > 2 && file[0] === 0x1f && file[1] === 0x8b;
    text = (isGzip ? gunzipSync(file) : file).toString("utf8");
  } catch {
    throw new ValidationError("This file is not a backup of the application.");
  }
  let parsed: Partial<BackupFile>;
  try {
    parsed = JSON.parse(text) as Partial<BackupFile>;
  } catch {
    throw new ValidationError("This file is not a backup of the application.");
  }
  if (
    parsed?.format !== BACKUP_FORMAT ||
    typeof parsed.tables !== "object" ||
    parsed.tables === null
  ) {
    throw new ValidationError("This file is not a backup of the application.");
  }
  if (parsed.version !== BACKUP_VERSION) {
    throw new ValidationError("This backup was made by another version of the application.");
  }
  for (const rows of Object.values(parsed.tables)) {
    if (!Array.isArray(rows)) {
      throw new ValidationError("This file is not a backup of the application.");
    }
  }
  return parsed as BackupFile;
}

/**
 * Replaces the whole database with the content of a backup. All or nothing.
 * Every session ends: people sign in again afterwards.
 */
export async function restoreBackup(file: Buffer): Promise<{ tables: number; rows: number }> {
  const backup = parseBackup(file);
  const client = await pool.connect();
  let restoredRows = 0;
  try {
    const current = await schemaVersion(client);
    if (backup.schemaVersion && current && backup.schemaVersion !== current) {
      throw new BusinessRuleError(
        "This backup was made with another version of the database. Restore it on the same version of the application.",
        "BACKUP_SCHEMA_MISMATCH"
      );
    }
    const tables = await listTables(client);
    const known = new Set(tables);
    const unknown = Object.keys(backup.tables).filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new BusinessRuleError(
        tr("This backup contains tables this application does not know: {tables}.", {
          tables: unknown.join(", "),
        }),
        "BACKUP_UNKNOWN_TABLES"
      );
    }

    await client.query("begin");
    const { rows: foreignKeys } = await client.query<{
      tableName: string;
      name: string;
      definition: string;
    }>(
      `select conrelid::regclass::text as "tableName", conname as name,
              pg_get_constraintdef(oid) as definition
         from pg_constraint
        where contype = 'f' and connamespace = 'public'::regnamespace`
    );
    for (const key of foreignKeys) {
      await client.query(`alter table ${key.tableName} drop constraint ${quoteIdent(key.name)}`);
    }

    await client.query(`truncate ${tables.map(quoteIdent).join(", ")} restart identity`);

    for (const [name, rows] of Object.entries(backup.tables)) {
      if (TRANSIENT_TABLES.has(name)) continue;
      for (let start = 0; start < rows.length; start += RESTORE_CHUNK) {
        const chunk = rows.slice(start, start + RESTORE_CHUNK);
        // The table's own row type converts every JSON value to its column type.
        await client.query(
          `insert into ${quoteIdent(name)}
             select * from json_populate_recordset(null::${quoteIdent(name)}, $1::json)`,
          [JSON.stringify(chunk)]
        );
        restoredRows += chunk.length;
      }
    }

    // Putting the keys back checks every link between the restored rows.
    for (const key of foreignKeys) {
      try {
        await client.query(
          `alter table ${key.tableName} add constraint ${quoteIdent(key.name)} ${key.definition}`
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new BusinessRuleError(
            tr("This backup is incomplete: some data points to data that is missing ({link}).", {
              link: key.name,
            }),
            "BACKUP_BROKEN_LINKS"
          );
        }
        throw error;
      }
    }
    // Sessions opened before the restore belong to the old data: they all end, access
    // tokens included.
    await client.query("update users set sessions_valid_after = now()");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  invalidateAllSessionStates();
  // The backup may come from before the super-administrator existed, or with another
  // password: the configured account is put back at once.
  await ensureSuperAdmin();
  return { tables: Object.keys(backup.tables).length, rows: restoredRows };
}

export const MAINTENANCE_ACTIONS = [
  "analyze",
  "purge-expired",
  "unlock-sign-in",
  "end-all-sessions",
] as const;
export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

/** Small technical operations. Returns how many rows were affected, when it applies. */
export async function runMaintenance(
  action: MaintenanceAction,
  currentUserId: string
): Promise<{ affected: number }> {
  switch (action) {
    case "analyze": {
      // Refreshes the statistics the database uses to choose how to run queries.
      await pool.query("analyze");
      return { affected: 0 };
    }
    case "purge-expired": {
      const tokens = await authRepository.purgeExpiredTokens();
      const counters = await pool.query("delete from rate_limit_hits where reset_at <= now()");
      return { affected: tokens + (counters.rowCount ?? 0) };
    }
    case "unlock-sign-in": {
      // Accounts blocked after too many wrong passwords can try again at once.
      const result = await pool.query("delete from rate_limit_hits");
      return { affected: result.rowCount ?? 0 };
    }
    case "end-all-sessions": {
      // Everybody signs in again, except the person asking.
      const client = await pool.connect();
      try {
        await client.query("begin");
        const revoked = await client.query(
          `update refresh_tokens set revoked_at = now()
            where revoked_at is null and user_id <> $1`,
          [currentUserId]
        );
        await client.query(
          "update users set sessions_valid_after = now(), updated_at = now() where id <> $1",
          [currentUserId]
        );
        await client.query("commit");
        invalidateAllSessionStates();
        return { affected: revoked.rowCount ?? 0 };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }
}
