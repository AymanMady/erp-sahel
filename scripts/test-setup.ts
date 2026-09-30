/**
 * Runs in every test worker before the test files: last check that the database the
 * server code is about to open is the local test database (`test-database.ts`).
 */

import { assertLocalDatabase } from "./test-database";

assertLocalDatabase(process.env.DATABASE_URL ?? "");
