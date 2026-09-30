/**
 * The desktop shell (Tauri) played in the browser, for the end-to-end tests.
 *
 * Bundled and injected before any page script (`offline-desktop.spec.ts`): the web
 * application then believes it runs in the shell. Its local database
 * (`src-tauri/src/local_db`) is the in-memory stand-in of the unit tests, kept in
 * `localStorage` after every command so that it survives a reload — as the SQLite file
 * survives closing the application. Everything else of the shell answers nothing.
 */

import { FakeLocalDb } from "../../client/src/shared/offline/__tests__/fake-local-db";

const STORAGE_KEY = "e2e.desktop.local-db";

type Saved = {
  company: string | null;
  tables: [string, [string, unknown][]][];
  queue: [string, unknown][];
  meta: [string, string][];
  progress: [string, unknown][];
  conflicts: [string, unknown][];
};

function restore(): FakeLocalDb {
  const db = new FakeLocalDb();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return db;
  const saved = JSON.parse(raw) as Saved;
  db.company = saved.company;
  db.tables = new Map(saved.tables.map(([name, rows]) => [name, new Map(rows)])) as never;
  db.queue = new Map(saved.queue) as never;
  db.meta = new Map(saved.meta);
  db.progress = new Map(saved.progress) as never;
  db.conflicts = new Map(saved.conflicts) as never;
  return db;
}

function save(db: FakeLocalDb): void {
  const saved: Saved = {
    company: db.company,
    tables: [...db.tables].map(([name, rows]) => [name, [...rows]]),
    queue: [...db.queue],
    meta: [...db.meta],
    progress: [...db.progress],
    conflicts: [...db.conflicts],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

const db = restore();

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args?: Record<string, unknown>) => {
    // The server of this workstation: the one serving the page.
    if (command === "device_config_read") return { serverUrl: location.origin, printer: null };
    if (!command.startsWith("local_") && !command.startsWith("offline_")) return null;
    const result = await db.invoke(command, args);
    save(db);
    return result;
  },
};
