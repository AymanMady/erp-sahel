/**
 * Prepares the **local test database** (`npm run test:db`): versioned migrations, then
 * the core seed (system roles, permissions) some integration tests rely on.
 *
 * The URL is checked first and handed to the child processes explicitly: `dotenv`
 * never overrides a variable already set, so `.env` cannot redirect them elsewhere.
 */

import { execFileSync } from "node:child_process";

import { assertLocalDatabase, resolveTestDatabaseUrl } from "./test-database";

const url = resolveTestDatabaseUrl();
assertLocalDatabase(url);

const target = new URL(url);
console.log(`→ Test database: ${target.hostname}:${target.port}${target.pathname}`);

const env = { ...process.env, DATABASE_URL: url, NODE_ENV: "test" };
execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env });
execFileSync("npx", ["tsx", "server/seed.ts", "--core-only"], { stdio: "inherit", env });
