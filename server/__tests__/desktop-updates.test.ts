/**
 * Desktop workstations: an outdated release is refused (and told to update), and the
 * update endpoint offers the release the server has chosen — never an older one, never
 * one built for another system.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { compareVersions, newestVersion } from "@shared/app-version";
import { clientVersionGate } from "../middleware/client-version";
import { errorHandler } from "../middleware/error-handler";
import { registerDesktopRoutes } from "../domains/desktop/routes";
import { clearReleaseCache } from "../domains/desktop/releases";

const MANIFEST_URL = "https://releases.example.com/latest.json";

const manifest = {
  version: "1.4.0",
  notes: "Impression des tickets",
  pub_date: "2026-09-01T00:00:00Z",
  platforms: {
    "windows-x86_64": { url: "https://releases.example.com/a.msi", signature: "sig" },
    "linux-x86_64-appimage": { url: "https://releases.example.com/a.AppImage", signature: "sig" },
  },
};

let server: Server;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use("/api", clientVersionGate);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/things", (_req, res) => res.json({ ok: true }));
  registerDesktopRoutes(app);
  app.use(errorHandler);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  clearReleaseCache();
  delete process.env.DESKTOP_MIN_VERSION;
  delete process.env.DESKTOP_UPDATE_MANIFEST_URL;
});

afterEach(() => vi.restoreAllMocks());

/** The manifest host answers with `body`; the test server itself stays reachable. */
function publishManifest(body: unknown, status = 200) {
  process.env.DESKTOP_UPDATE_MANIFEST_URL = MANIFEST_URL;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === MANIFEST_URL) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  });
}

function call(path: string, headers: Record<string, string> = {}) {
  return realFetch(`${baseUrl}${path}`, { headers });
}

describe("version numbers", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0-beta")).toBe(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("the configuration can raise the floor, never lower it", () => {
    expect(newestVersion("1.2.0", "1.5.0")).toBe("1.5.0");
    expect(newestVersion("1.2.0", "1.0.0")).toBe("1.2.0");
    expect(newestVersion("1.2.0", "not a version")).toBe("1.2.0");
  });
});

describe("outdated desktop workstations", () => {
  it("are refused with an upgrade code", async () => {
    process.env.DESKTOP_MIN_VERSION = "1.3.0";
    const response = await call("/api/things", {
      "X-Device-Platform": "desktop",
      "X-App-Version": "1.2.9",
    });
    expect(response.status).toBe(426);
    const body = (await response.json()) as { code: string; details: { minVersion: string } };
    expect(body.code).toBe("CLIENT_UPGRADE_REQUIRED");
    expect(body.details.minVersion).toBe("1.3.0");
  });

  it("without a version header count as the first release", async () => {
    process.env.DESKTOP_MIN_VERSION = "1.0.1";
    const response = await call("/api/things", { "X-Device-Platform": "desktop" });
    expect(response.status).toBe(426);
  });

  it("still reach the health probe and the update endpoint", async () => {
    process.env.DESKTOP_MIN_VERSION = "9.0.0";
    const headers = { "X-Device-Platform": "desktop", "X-App-Version": "1.0.0" };
    expect((await call("/api/health", headers)).status).toBe(200);
    expect((await call("/api/desktop/update/windows/x86_64/1.0.0", headers)).status).toBe(204);
  });

  it("recent workstations and browsers go through", async () => {
    process.env.DESKTOP_MIN_VERSION = "1.3.0";
    const recent = await call("/api/things", {
      "X-Device-Platform": "desktop",
      "X-App-Version": "1.3.0",
    });
    expect(recent.status).toBe(200);
    expect((await call("/api/things", { "X-Device-Platform": "web" })).status).toBe(200);
  });
});

describe("update endpoint", () => {
  it("offers nothing when no manifest is configured", async () => {
    const response = await call("/api/desktop/update/windows/x86_64/1.0.0");
    expect(response.status).toBe(204);
  });

  it("offers a newer release published for the workstation's system", async () => {
    publishManifest(manifest);
    const windows = await call("/api/desktop/update/windows/x86_64/1.3.2");
    expect(windows.status).toBe(200);
    expect(((await windows.json()) as { version: string }).version).toBe("1.4.0");
    // A key with an installer suffix counts for its system.
    expect((await call("/api/desktop/update/linux/x86_64/1.0.0")).status).toBe(200);
  });

  it("offers nothing to an up-to-date workstation or an unpublished system", async () => {
    publishManifest(manifest);
    expect((await call("/api/desktop/update/windows/x86_64/1.4.0")).status).toBe(204);
    expect((await call("/api/desktop/update/windows/x86_64/1.5.0")).status).toBe(204);
    expect((await call("/api/desktop/update/darwin/aarch64/1.0.0")).status).toBe(204);
  });

  it("says so when the manifest cannot be read", async () => {
    publishManifest({ version: "not a version", platforms: {} });
    const response = await call("/api/desktop/update/windows/x86_64/1.0.0");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("UPDATE_MANIFEST_UNAVAILABLE");
  });
});
