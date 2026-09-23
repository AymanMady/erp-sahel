/**
 * Applique les migrations SQL générées par `drizzle-kit generate`.
 *
 * Préféré à `drizzle-kit push` en production : `push` compare le schéma et applique
 * des différences calculées à la volée, ce qui peut détruire une colonne renommée.
 * Les migrations versionnées, elles, sont revues avant d'être jouées.
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDatabase, db } from "../server/db";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

async function main(): Promise<void> {
  console.log(`→ Application des migrations depuis ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log("✔ Migrations appliquées.");
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Échec des migrations :", error);
    await closeDatabase();
    process.exit(1);
  });
