/**
 * Excel import and export of products and parties.
 *
 * Checks the round trip (an exported file imports back unchanged), matching by code
 * (update rather than duplicate), and that a file with a single bad row saves nothing.
 */

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "../db";
import { catalogRepository } from "../domains/catalog/repository";
import { catalogService } from "../domains/catalog/service";
import { partiesApplication } from "../domains/parties/application";
import { partiesService } from "../domains/parties/service";
import { withLocale } from "../shared/i18n";
import { AppError } from "../shared/errors/app-error";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;

beforeAll(async () => {
  context = await createTestCompany("xlsx");
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

async function workbookOf(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected the import to be refused");
}

describe("products", () => {
  it("imports back an exported file without creating duplicates", async () => {
    const product = await createStockedProduct(context, { sku: "XL-001", salePriceCents: 12_550 });

    const file = await withLocale("fr", () => catalogService.exportProducts(context.company.id));
    const result = await catalogService.importProducts(context.company.id, file);

    expect(result).toEqual({ created: 0, updated: 1 });
    const reloaded = await catalogRepository.findById(context.company.id, product.id);
    expect(reloaded?.salePriceCents).toBe(12_550);
  });

  it("updates by name, creates with an automatic code and ignores any code column", async () => {
    const file = await workbookOf([
      [
        "Code du produit",
        "Nom du produit",
        "Catégorie",
        "Prix de vente (MRU)",
        "Service (sans stock)",
      ],
      ["IGNORED-1", "  test ITEM ", "Alimentation", "1 500,50", "Non"],
      ["IGNORED-2", "Pose de carrelage", "", 300, "Oui"],
    ]);

    const result = await catalogService.importProducts(context.company.id, file);
    expect(result).toEqual({ created: 1, updated: 1 });

    const { items } = await catalogRepository.search(context.company.id, { limit: 50 });
    const item = items.find((candidate) => candidate.sku === "XL-001");
    // The stored code is kept; the name is taken from the file.
    expect(item?.name).toBe("test ITEM");
    expect(item?.salePriceCents).toBe(150_050);
    expect(item?.categoryName).toBe("Alimentation");
    // Absent from the file: kept as it was.
    expect(item?.purchasePriceCents).toBe(1_000);

    const service = items.find((candidate) => candidate.name === "Pose de carrelage");
    expect(service?.isService).toBe(true);
    expect(service?.sku).toMatch(/^SRV-\d{4}$/);
    expect(items.some((candidate) => candidate.sku.startsWith("IGNORED"))).toBe(false);
  });

  it("refuses a name used twice, in the file or among existing products", async () => {
    const twice = await workbookOf([["Product name"], ["Sel"], ["sel"]]);
    const inFile = await rejection(catalogService.importProducts(context.company.id, twice));
    expect((inFile.details as { row: number }[]).map((issue) => issue.row)).toEqual([3]);

    await createStockedProduct(context, { sku: "DUP-1" });
    const ambiguous = await workbookOf([["Product name"], ["Test item"]]);
    const inDatabase = await rejection(
      catalogService.importProducts(context.company.id, ambiguous)
    );
    expect(inDatabase.code).toBe("IMPORT_INVALID");
  });

  it("saves nothing when one row is wrong, and says which row", async () => {
    const file = await workbookOf([
      ["Product name", "Sale price (MRU)"],
      ["Sucre", 100],
      ["Thé", "beaucoup"],
      ["", 50],
    ]);

    const error = await rejection(catalogService.importProducts(context.company.id, file));
    expect(error.code).toBe("IMPORT_INVALID");
    expect((error.details as { row: number }[]).map((issue) => issue.row)).toEqual([3, 4]);

    const { items } = await catalogRepository.search(context.company.id, { search: "Sucre" });
    expect(items).toHaveLength(0);
  });

  it("refuses a file that is not an Excel file", async () => {
    const error = await rejection(
      catalogService.importProducts(context.company.id, Buffer.from("name;price\nx;1"))
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

describe("customers and suppliers", () => {
  it("reads types and titles in any language and checks phone numbers", async () => {
    const file = await workbookOf([
      ["الاسم", "النوع", "الهاتف", "Crédit maximum autorisé (MRU)"],
      ["Boutique Nour", "مورد", "22 12 34 56", 5000],
      ["Client Ahmed", "Client", null, null],
    ]);
    const result = await partiesService.importParties(context.company.id, file);
    expect(result).toEqual({ created: 2, updated: 0 });

    const suppliers = await partiesApplication.list(context.company.id, { search: "Nour" });
    expect(suppliers.items[0]).toMatchObject({
      partyType: "SUPPLIER",
      phone: "22123456",
      creditLimitCents: 500_000,
    });
    expect(suppliers.items[0].code).toMatch(/^FRN-\d{4}$/);

    const bad = await workbookOf([
      ["Name", "Type", "Phone"],
      ["Someone", "Friend", "123"],
    ]);
    const error = await rejection(partiesService.importParties(context.company.id, bad));
    expect(error.details).toHaveLength(2);
  });

  it("round-trips the export", async () => {
    const file = await partiesService.exportParties(context.company.id);
    const result = await partiesService.importParties(context.company.id, file);
    expect(result.created).toBe(0);
    expect(result.updated).toBeGreaterThanOrEqual(2);
  });
});
