/**
 * Fonctionnalités activables (caisse, achats, stock…) et types d'activité.
 *
 * Garanties vérifiées : une société existante garde tout son périmètre (actif par
 * défaut), un préréglage active exactement ses modules et leurs dépendances, et une
 * fonctionnalité désactivée ferme ses routes API.
 */

import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUSINESS_PRESETS, FEATURE_MODULES } from "@shared/modules-catalog";
import { companyPlugins } from "@shared/schema";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../db";
import { signAccessToken } from "../domains/auth/tokens";
import { featureGate } from "../domains/plugins/features";
import { pluginRegistry } from "../domains/plugins/registry";
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

describe("état par défaut", () => {
  it("active les fonctionnalités et laisse les métiers désactivés tant que rien n'est choisi", async () => {
    await db.delete(companyPlugins).where(eq(companyPlugins.companyId, context.company.id));
    const enabled = await pluginRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual(FEATURE_MODULES.map((feature) => feature.code).sort());
  });

  it("permet de désactiver une fonctionnalité qui n'a encore aucune ligne en base", async () => {
    await db.delete(companyPlugins).where(eq(companyPlugins.companyId, context.company.id));
    await pluginRegistry.disableForCompany(context.company.id, "accounting");
    expect(await pluginRegistry.isEnabled(context.company.id, "accounting")).toBe(false);
  });
});

describe("types d'activité", () => {
  it("active exactement les modules du préréglage « Boutique »", async () => {
    const shop = BUSINESS_PRESETS.find((preset) => preset.code === "shop")!;
    await pluginRegistry.applySelection(context.company.id, shop.modules);
    const enabled = await pluginRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual([...shop.modules].sort());
  });

  it("ajoute les dépendances d'un module choisi", async () => {
    await pluginRegistry.applySelection(context.company.id, ["sales"]);
    const enabled = await pluginRegistry.enabledCodes(context.company.id);
    expect(enabled.sort()).toEqual(["invoicing", "sales"]);
  });

  it("refuse de retirer un module dont un autre dépend", async () => {
    await pluginRegistry.applySelection(context.company.id, ["purchasing"]);
    await expect(pluginRegistry.disableForCompany(context.company.id, "inventory")).rejects.toThrow(
      /Désactivez d'abord/
    );
  });
});

describe("garde des routes", () => {
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

  it("refuse la caisse quand elle est désactivée", () => {
    expect(run("/api/pos/tickets", token(["inventory"]))).toBeInstanceOf(ModuleDisabledError);
  });

  it("laisse passer la caisse quand elle est active", () => {
    expect(run("/api/pos/tickets", token(["pos"]))).toBeUndefined();
  });

  it("garde ouvertes les lectures partagées avec d'autres écrans", () => {
    expect(run("/api/banking/accounts", token([]), "GET")).toBeUndefined();
    expect(run("/api/banking/transactions", token([]), "GET")).toBeInstanceOf(ModuleDisabledError);
  });

  it("ne touche pas aux routes du noyau", () => {
    expect(run("/api/catalog/products", token([]), "GET")).toBeUndefined();
    expect(run("/api/warehouses", token([]), "GET")).toBeUndefined();
  });

  it("accepte les jetons émis avant l'arrivée des fonctionnalités activables", () => {
    expect(run("/api/pos/tickets", token(["auto_parts"], false))).toBeUndefined();
  });
});
