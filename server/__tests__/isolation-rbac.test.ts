/**
 * Isolation multi-société ([BR-13]) et autorisations ([FR-AUTH-2], [BR-12]).
 *
 * Ce sont les deux garanties que l'interface ne peut pas assurer : elles doivent tenir
 * même si l'appelant forge sa requête.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasAnyPermission, resolveRolePermissions, DEFAULT_ROLES } from "@shared/rbac";
import { satisfiesRange } from "../domains/plugins/semver";
import { closeDatabase, db as database } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { pluginRegistry } from "../domains/plugins/registry";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let alpha: TestContext;
let beta: TestContext;

beforeAll(async () => {
  alpha = await createTestCompany("alpha");
  beta = await createTestCompany("beta");
});

afterAll(async () => {
  await dropTestCompany(alpha);
  await dropTestCompany(beta);
  await closeDatabase();
});

describe("isolation des données entre sociétés", () => {
  it("ne laisse pas voir le catalogue d'une autre société", async () => {
    const product = await createStockedProduct(alpha, { sku: "ISO-001" });

    const fromAlpha = await catalogApplication.search(alpha.company.id, { search: "ISO-001" });
    expect(fromAlpha.items).toHaveLength(1);

    const fromBeta = await catalogApplication.search(beta.company.id, { search: "ISO-001" });
    expect(fromBeta.items).toHaveLength(0);

    // Même en connaissant l'identifiant, l'accès direct est refusé.
    await expect(catalogApplication.getDetail(beta.company.id, product.id)).rejects.toThrow(
      /introuvable/i
    );
  });

  it("ne laisse pas facturer un tiers d'une autre société", async () => {
    const customer = await partiesApplication.create(
      alpha.company.id,
      { name: "Client Alpha", partyType: "CUSTOMER" },
      database
    );
    const product = await createStockedProduct(beta, { sku: "ISO-002" });

    await expect(
      invoicingApplication.create(
        beta.company,
        {
          // Client appartenant à la société Alpha, produit à la société Beta.
          partyId: customer.id,
          lines: [{ productId: product.id, quantity: 1, description: "Article" }],
        },
        beta.userId
      )
    ).rejects.toThrow(/introuvable/i);
  });

  it("empêche d'utiliser le produit d'une autre société sur une facture", async () => {
    const productAlpha = await createStockedProduct(alpha, { sku: "ISO-003" });
    const customerBeta = await partiesApplication.create(
      beta.company.id,
      { name: "Client Beta", partyType: "CUSTOMER" },
      database
    );

    await expect(
      invoicingApplication.create(
        beta.company,
        {
          partyId: customerBeta.id,
          lines: [{ productId: productAlpha.id, quantity: 1, description: "Article" }],
        },
        beta.userId
      )
    ).rejects.toThrow(/appartenant à une autre société/i);
  });

  it("attribue des séquences de numérotation indépendantes par société", async () => {
    const customerAlpha = await partiesApplication.create(
      alpha.company.id,
      { name: "Client A", partyType: "CUSTOMER" },
      database
    );
    const customerBeta = await partiesApplication.create(
      beta.company.id,
      { name: "Client B", partyType: "CUSTOMER" },
      database
    );
    const productAlpha = await createStockedProduct(alpha, { sku: "SEQ-A" });
    const productBeta = await createStockedProduct(beta, { sku: "SEQ-B" });

    const invoiceAlpha = await invoicingApplication.create(
      alpha.company,
      {
        partyId: customerAlpha.id,
        lines: [{ productId: productAlpha.id, quantity: 1, description: "A" }],
        validate: true,
      },
      alpha.userId
    );
    const invoiceBeta = await invoicingApplication.create(
      beta.company,
      {
        partyId: customerBeta.id,
        lines: [{ productId: productBeta.id, quantity: 1, description: "B" }],
        validate: true,
      },
      beta.userId
    );

    // Deux sociétés démarrent chacune leur propre séquence : le premier numéro est
    // identique, ce qui est attendu et sans conflit puisque l'unicité est par société.
    expect(invoiceAlpha.number).toBe(invoiceBeta.number);
  });
});

describe("modèle de permissions", () => {
  it("donne toutes les permissions à l'administrateur", () => {
    const administrator = DEFAULT_ROLES.find((role) => role.slug === "administrateur");
    expect(resolveRolePermissions(administrator!.permissions).length).toBeGreaterThan(30);
  });

  it("n'accorde au vendeur ni comptabilité ni administration", () => {
    const seller = DEFAULT_ROLES.find((role) => role.slug === "vendeur");
    const permissions = resolveRolePermissions(seller!.permissions);
    expect(permissions).toContain("pos.use");
    expect(permissions).toContain("invoicing.write");
    expect(permissions).not.toContain("accounting.write");
    expect(permissions).not.toContain("users.write");
    expect(permissions).not.toContain("modules.manage");
  });

  it("limite le rôle consultation à la lecture", () => {
    const readOnly = DEFAULT_ROLES.find((role) => role.slug === "consultation");
    const permissions = resolveRolePermissions(readOnly!.permissions);
    expect(permissions.every((code) => code.endsWith(".read"))).toBe(true);
  });

  it("évalue « au moins une permission » correctement", () => {
    expect(hasAnyPermission(["invoicing.read"], ["invoicing.read", "invoicing.write"])).toBe(true);
    expect(hasAnyPermission(["invoicing.read"], ["accounting.write"])).toBe(false);
    // Une liste d'exigences vide n'est pas une restriction.
    expect(hasAnyPermission([], [])).toBe(true);
  });
});

describe("registre de modules", () => {
  it("expose les trois modules avec leur état d'activation", async () => {
    const modules = await pluginRegistry.listForCompany(alpha.company.id);
    expect(modules.map((module) => module.code).sort()).toEqual([
      "auto_parts",
      "clothing",
      "market",
    ]);
    expect(modules.every((module) => module.isEnabled)).toBe(true);
  });

  it("rend le module inaccessible une fois désactivé", async () => {
    await pluginRegistry.disableForCompany(alpha.company.id, "clothing");
    expect(await pluginRegistry.isEnabled(alpha.company.id, "clothing")).toBe(false);

    // Un profil de module désactivé est refusé à la création de produit ([BR-12]).
    await expect(
      catalogApplication.create(
        alpha.company.id,
        {
          sku: "MOD-OFF",
          name: "Vêtement",
          description: "",
          profileType: "CLOTHING",
          categoryId: null,
          unit: "pièce",
          barcode: "",
          purchasePriceCents: 0,
          salePriceCents: 1_000,
          vatRateBp: 0,
          isService: false,
          imageUrls: [],
          minStock: "0",
          variants: [],
          profile: {},
          initialStock: null,
        },
        alpha.userId
      )
    ).rejects.toThrow(/n'est pas activé/i);

    await pluginRegistry.enableForCompany(alpha.company.id, "clothing");
  });

  it("vérifie la compatibilité SemVer entre noyau et module", () => {
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(true);
    expect(satisfiesRange("1.4.2", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", "~1.0.0")).toBe(true);
    expect(satisfiesRange("1.1.0", "~1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", ">=0.9.0")).toBe(true);
    // Une plage non reconnue est refusée plutôt que tolérée.
    expect(satisfiesRange("1.0.0", "wat")).toBe(false);
  });
});
