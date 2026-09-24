/**
 * Toggleable modules (POS, purchasing, stock…) and presets.
 *
 * Guarantees checked: an existing company keeps its whole scope (enabled by default),
 * a preset enables exactly its modules and their dependencies, and a disabled feature
 * closes its API routes.
 */

import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FEATURE_MODULES, MODULE_PRESETS } from "@shared/modules-catalog";
import { companyPlugins } from "@shared/schema";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../db";
import { signAccessToken } from "../domains/auth/tokens";
import { featureGate } from "../domains/plugins/features";
import { moduleRegistry } from "../domains/plugins/registry";
import { ModuleDisabledError } from "../shared/errors/app-error";
import { createTestCompany, dropTestCompany, type TestContext } from "./helpers";

let context: TestContext;

beforeAll(async () => {
  process.env.JWT_SECRET ??= "test-secret-for-feature-modules";
  context = await createTestCompany("features");
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

describe("default state", () => {
  it("enables every module as long as nothing is chosen", async () => {
    await db.delete(companyPlugins).where(eq(companyPlugins.companyId, context.company.id));
    const enabled = await moduleRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual(FEATURE_MODULES.map((feature) => feature.code).sort());
  });

  it("allows disabling a module that has no database row yet", async () => {
    await db.delete(companyPlugins).where(eq(companyPlugins.companyId, context.company.id));
    await moduleRegistry.disableForCompany(context.company.id, "accounting");
    expect(await moduleRegistry.isEnabled(context.company.id, "accounting")).toBe(false);
  });
});

describe("presets", () => {
  it('enables exactly the modules of the "Simple" preset', async () => {
    const simple = MODULE_PRESETS.find((preset) => preset.code === "simple")!;
    await moduleRegistry.applySelection(context.company.id, simple.modules);
    const enabled = await moduleRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual([...simple.modules].sort());
  });

  it("adds the dependencies of a chosen module", async () => {
    await moduleRegistry.applySelection(context.company.id, ["sales"]);
    const enabled = await moduleRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual(["invoicing", "sales"]);
  });

  it("refuses to remove a module another one depends on", async () => {
    await moduleRegistry.applySelection(context.company.id, ["purchasing"]);
    await expect(
      moduleRegistry.disableForCompany(context.company.id, "inventory")
    ).rejects.toMatchObject({
      code: "MODULE_DEPENDENT_ENABLED",
    });
  });
});

describe("route guard", () => {
  function run(path: string, token: string, method = "POST"): unknown {
    let received: unknown = "not-called";
    const req = {
      method,
      originalUrl: path,
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    featureGate(
      req,
      {} as Response,
      ((error?: unknown) => {
        received = error;
      }) as NextFunction
    );
    return received;
  }

  function token(modules: string[], featureGating = true) {
    return signAccessToken({
      sub: context.userId,
      username: "test",
      companyId: context.company.id,
      isSuperuser: false,
      permissions: [],
      modules,
      featureGating,
    });
  }

  it("rejects the POS when it is disabled", () => {
    expect(run("/api/pos/tickets", token(["inventory"]))).toBeInstanceOf(ModuleDisabledError);
  });

  it("lets the POS through when it is enabled", () => {
    expect(run("/api/pos/tickets", token(["pos"]))).toBeUndefined();
  });

  it("keeps reads shared with other screens open", () => {
    expect(run("/api/banking/accounts", token([]), "GET")).toBeUndefined();
    expect(run("/api/banking/transactions", token([]), "GET")).toBeInstanceOf(ModuleDisabledError);
  });

  it("leaves core routes alone", () => {
    expect(run("/api/catalog/products", token([]), "GET")).toBeUndefined();
    expect(run("/api/warehouses", token([]), "GET")).toBeUndefined();
  });

  it("accepts tokens issued before toggleable modules existed", () => {
    expect(run("/api/pos/tickets", token([], false))).toBeUndefined();
  });
});
