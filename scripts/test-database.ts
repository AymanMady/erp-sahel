/**
 * Database used by the integration tests — and only by them.
 *
 * `.env` may point at the production database (it does on the developer machines that
 * deploy). The tests create and delete companies: run against production, they would
 * write into real data. So the test database is never read from `DATABASE_URL`:
 *  - `TEST_DATABASE_URL` when set;
 *  - on CI, `DATABASE_URL` (the disposable service container);
 *  - otherwise the local container of `docker-compose.yml`, database `erp_sahel_test`.
 *
 * Whatever the source, a host that is not local is refused before any connection.
 */

export const DEFAULT_TEST_DATABASE_URL = "postgresql://erp:erp@localhost:5436/erp_sahel_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (env.CI && env.DATABASE_URL) return env.DATABASE_URL;
  return DEFAULT_TEST_DATABASE_URL;
}

/** Throws unless the URL targets a PostgreSQL server on this machine. */
export function assertLocalDatabase(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("The test database URL is not a valid connection string.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refused: the tests must run on a local PostgreSQL, not on "${host}". ` +
        "Start `docker compose up -d db` or set TEST_DATABASE_URL to a local database."
    );
  }
}
