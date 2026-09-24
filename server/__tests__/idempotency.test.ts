/**
 * A write replayed by the offline queue with the same `Idempotency-Key` must run only
 * once: the replay receives the original response ([BR-8]).
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

process.env.JWT_SECRET ??= "test-secret-that-is-long-enough";

const { idempotency } = await import("../middleware/idempotency");
const { signAccessToken } = await import("../domains/auth/tokens");

let server: Server;
let baseUrl: string;
let executions = 0;

function token(companyId: string): string {
  return signAccessToken({
    sub: randomUUID(),
    username: "cashier",
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
    res.status(422).json({ error: "rejected" });
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

function post(path: string, key: string, auth: string, body: unknown = { name: "Filters" }) {
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

describe("idempotency of replayed writes", () => {
  it("runs only once and returns the original response on replay", async () => {
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

  it("allows retrying a rejected write", async () => {
    const key = randomUUID();
    const auth = token(randomUUID());
    await post("/api/fail", key, auth);
    await post("/api/fail", key, auth);
    expect(executions).toBe(2);
  });

  it("refuses reuse of a key by another company", async () => {
    const key = randomUUID();
    await post("/api/catalog/categories", key, token(randomUUID()));
    const other = await post("/api/catalog/categories", key, token(randomUUID()));
    expect(other.status).toBe(409);
    expect(executions).toBe(1);
  });
});
