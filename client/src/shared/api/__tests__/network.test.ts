/**
 * Connectivity detection: the app must only switch to offline mode when the server
 * really stops answering — not on a busy server or a single lost ping.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Network = typeof import("../network");
type Http = typeof import("../http");

let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fresh modules: the last ping result is module state. */
async function load(): Promise<{ network: Network; http: Http }> {
  vi.resetModules();
  return { network: await import("../network"), http: await import("../http") };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server ping", () => {
  it("counts a busy server (429) as online", async () => {
    const { network } = await load();
    fetchMock.mockResolvedValue(reply(429));
    expect(await network.probeServer(true)).toBe(true);
  });

  it("confirms a failed ping before going offline", async () => {
    const { network } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(reply(200, { status: "ok" }));
    expect(await network.probeServer(true)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(network.lastKnownOnline()).toBe(true);
  });

  it("goes offline when the server keeps not answering", async () => {
    const { network } = await load();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await network.probeServer(true)).toBe(false);
    expect(network.lastKnownOnline()).toBe(false);
  });

  it("shares one ping between simultaneous callers", async () => {
    const { network } = await load();
    fetchMock.mockResolvedValue(reply(200, { status: "ok" }));
    await Promise.all([network.probeServer(true), network.probeServer(true)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reads", () => {
  it("retries once when the server is starting", async () => {
    const { http } = await load();
    fetchMock.mockResolvedValueOnce(reply(503));
    fetchMock.mockResolvedValueOnce(reply(200, { value: 42 }));
    expect(await http.api.get("/api/dashboard")).toEqual({ value: 42 });
  });

  it("stays online after a single failed read", async () => {
    const { network, http } = await load();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/health/db") return reply(200, { status: "ok" });
      throw new TypeError("Failed to fetch");
    });
    await expect(http.api.get("/api/reports/sales")).rejects.toMatchObject({
      isNetworkError: true,
    });
    await network.probeServer();
    expect(network.lastKnownOnline()).toBe(true);
  });
});
