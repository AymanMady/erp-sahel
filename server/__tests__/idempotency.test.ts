/**
 * Une écriture rejouée par la file hors ligne avec la même `Idempotency-Key` ne doit
 * s'exécuter qu'une fois : le rejeu reçoit la réponse d'origine ([BR-8]).
 */

import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const journal = new Map<string, Record<string, unknown>>();

vi.mock("../domains/sync/repository", () => ({
  syncRepository: {
    findByClientUuid: async (key: string) => journal.get(key) ?? null,
    record: async (values: Record<string, unknown>) => {
      journal.set(String(values.clientUuid), values);
      return values;
    },
  },
}));

process.env.JWT_SECRET ??= "secret-de-test-suffisamment-long";

const { idempotency } = await import("../middleware/idempotency");
const { signAccessToken } = await import("../domains/auth/tokens");

let server: Server;
let baseUrl: string;
let executions = 0;

function token(companyId: string): string {
  return signAccessToken({
    sub: randomUUID(),
    username: "caissier",
    companyId,
    isSuperuser: false,
    permissions: [],
    modules: [],
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", idempotency);
  app.post("/api/catalog/categories", (req, res) => {
    executions += 1;
    res.status(201).json({ id: randomUUID(), name: req.body.name });
  });
  app.post("/api/fail", (_req, res) => {
    executions += 1;
    res.status(422).json({ error: "refus" });
  });
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  journal.clear();
  executions = 0;
});

function post(path: string, key: string, auth: string, body: unknown = { name: "Filtres" }) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth}`,
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("idempotence des écritures rejouées", () => {
  it("n'exécute qu'une fois et renvoie la réponse d'origine au rejeu", async () => {
    const key = randomUUID();
    const auth = token(randomUUID());

    const first = await post("/api/catalog/categories", key, auth);
    const replay = await post("/api/catalog/categories", key, auth);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    expect(executions).toBe(1);
  });

  it("laisse retenter une écriture refusée", async () => {
    const key = randomUUID();
    const auth = token(randomUUID());
    await post("/api/fail", key, auth);
    await post("/api/fail", key, auth);
    expect(executions).toBe(2);
  });

  it("refuse la réutilisation d'une clé par une autre société", async () => {
    const key = randomUUID();
    await post("/api/catalog/categories", key, token(randomUUID()));
    const other = await post("/api/catalog/categories", key, token(randomUUID()));
    expect(other.status).toBe(409);
    expect(executions).toBe(1);
  });
});
