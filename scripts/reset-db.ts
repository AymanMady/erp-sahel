/**
 * Réinitialise complètement la base : suppression du schéma public puis recréation.
 *
 * Réservé au développement et aux démonstrations. Le garde-fou `NODE_ENV=production`
 * est volontaire : effacer une base de production par inadvertance est irréversible.
 */

import "dotenv/config";

import { closeDatabase, pool } from "../server/db";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESET !== "yes") {
    throw new Error(
      "Refusé en production. Définissez ALLOW_DB_RESET=yes si c'est réellement voulu."
    );
  }

  console.log("→ Suppression du schéma public…");
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
  console.log("✔ Base réinitialisée. Lancez « npm run db:push » puis « npm run db:seed ».");
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
