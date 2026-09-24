/**
 * Fully resets the database: drops the public schema, then recreates it.
 *
 * Intended for development and demos only. The `NODE_ENV=production` guard is
 * deliberate: accidentally wiping a production database is irreversible.
 */

import "dotenv/config";

import { closeDatabase, pool } from "../server/db";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESET !== "yes") {
    throw new Error("Refused in production. Set ALLOW_DB_RESET=yes if this is really intended.");
  }

  console.log("→ Dropping public schema…");
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
  console.log('✔ Database reset. Run "npm run db:push" then "npm run db:seed".');
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDatabase();
    process.exit(1);
  });
