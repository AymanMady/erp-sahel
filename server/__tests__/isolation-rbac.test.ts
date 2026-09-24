/**
 * Multi-company isolation ([BR-13]) and authorization ([FR-AUTH-2]).
 *
 * These are the two guarantees the UI cannot provide: they must hold even when the
 * caller forges its request.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasAnyPermission, resolveRolePermissions, DEFAULT_ROLES } from "@shared/rbac";
import { closeDatabase, db as database } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
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

describe("data isolation between companies", () => {
  it("does not expose another company's catalog", async () => {
    const product = await createStockedProduct(alpha, { sku: "ISO-001" });

    const fromAlpha = await catalogApplication.search(alpha.company.id, { search: "ISO-001" });
    expect(fromAlpha.items).toHaveLength(1);

    const fromBeta = await catalogApplication.search(beta.company.id, { search: "ISO-001" });
    expect(fromBeta.items).toHaveLength(0);

    // Even when the id is known, direct access is refused.
    await expect(catalogApplication.getDetail(beta.company.id, product.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not allow invoicing a party of another company", async () => {
    const customer = await partiesApplication.create(
      alpha.company.id,
      { name: "Customer Alpha", partyType: "CUSTOMER" },
      database
    );
    const product = await createStockedProduct(beta, { sku: "ISO-002" });

    await expect(
      invoicingApplication.create(
        beta.company,
        {
          // Customer belonging to company Alpha, product belonging to company Beta.
          partyId: customer.id,
          lines: [{ productId: product.id, quantity: 1, description: "Article" }],
        },
        beta.userId
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("prevents using another company's product on an invoice", async () => {
    const productAlpha = await createStockedProduct(alpha, { sku: "ISO-003" });
    const customerBeta = await partiesApplication.create(
      beta.company.id,
      { name: "Customer Beta", partyType: "CUSTOMER" },
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
    ).rejects.toMatchObject({
      code: "BUSINESS_RULE",
      message: expect.stringMatching(/another company/i),
    });
  });

  it("assigns independent numbering sequences per company", async () => {
    const customerAlpha = await partiesApplication.create(
      alpha.company.id,
      { name: "Customer A", partyType: "CUSTOMER" },
      database
    );
    const customerBeta = await partiesApplication.create(
      beta.company.id,
      { name: "Customer B", partyType: "CUSTOMER" },
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

    // Each company starts its own sequence: the first number is identical, which is
    // expected and conflict-free since uniqueness is per company.
    expect(invoiceAlpha.number).toBe(invoiceBeta.number);
  });
});

describe("permission model", () => {
  it("grants every permission to the administrator", () => {
    const administrator = DEFAULT_ROLES.find((role) => role.slug === "administrateur");
    expect(resolveRolePermissions(administrator!.permissions).length).toBeGreaterThan(30);
  });

  it("grants the salesperson neither accounting nor administration", () => {
    const seller = DEFAULT_ROLES.find((role) => role.slug === "vendeur");
    const permissions = resolveRolePermissions(seller!.permissions);
    expect(permissions).toContain("pos.use");
    expect(permissions).toContain("invoicing.write");
    expect(permissions).not.toContain("accounting.write");
    expect(permissions).not.toContain("users.write");
    expect(permissions).not.toContain("modules.manage");
  });

  it("limits the read-only role to reads", () => {
    const readOnly = DEFAULT_ROLES.find((role) => role.slug === "consultation");
    const permissions = resolveRolePermissions(readOnly!.permissions);
    expect(permissions.every((code) => code.endsWith(".read"))).toBe(true);
  });

  it('evaluates "at least one permission" correctly', () => {
    expect(hasAnyPermission(["invoicing.read"], ["invoicing.read", "invoicing.write"])).toBe(true);
    expect(hasAnyPermission(["invoicing.read"], ["accounting.write"])).toBe(false);
    // An empty list of requirements is not a restriction.
    expect(hasAnyPermission([], [])).toBe(true);
  });
});
