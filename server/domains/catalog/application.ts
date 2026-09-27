/**
 * Catalog use cases.
 *
 * The catalog is generic: the same product serves any kind of business. This layer
 * enriches lists with stock levels, which belong to the `inventory` domain and are
 * therefore only read through its application layer.
 */

import type { Product } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { matchByName, type ImportResult } from "../../shared/spreadsheet/workbook";
import { inventoryApplication } from "../inventory/application";
import {
  catalogRepository,
  categoriesRepository,
  type ProductExportRow,
  type ProductSearchOptions,
} from "./repository";
import type { CreateProductInput, UpdateProductInput } from "./schemas";
import type { ProductImportRow } from "./spreadsheet";

export interface ProductListItem extends Product {
  categoryName: string | null;
  /** Balance across all warehouses; absent unless `withStock` is requested. */
  stockQuantity?: number;
}

export interface ProductDetail extends Product {
  variants: Awaited<ReturnType<typeof catalogRepository.listVariants>>;
  suppliers: Awaited<ReturnType<typeof catalogRepository.listProductSuppliers>>;
  stockQuantity: number;
}

class CatalogApplication {
  async search(
    companyId: string,
    options: ProductSearchOptions & { withStock?: boolean } = {}
  ): Promise<{ items: ProductListItem[]; total: number }> {
    const result = await catalogRepository.search(companyId, options);
    if (!options.withStock || result.items.length === 0) return result;

    const quantities = await inventoryApplication.quantitiesByProduct(
      companyId,
      result.items.map((item) => item.id)
    );
    return {
      items: result.items.map((item) => ({
        ...item,
        stockQuantity: quantities.get(item.id) ?? 0,
      })),
      total: result.total,
    };
  }

  async getDetail(companyId: string, productId: string): Promise<ProductDetail> {
    const product = await catalogRepository.findById(companyId, productId);
    if (!product) throw new NotFoundError("Product not found.");

    const [variants, suppliers, quantities] = await Promise.all([
      catalogRepository.listVariants(companyId, productId),
      catalogRepository.listProductSuppliers(companyId, productId),
      inventoryApplication.quantitiesByProduct(companyId, [productId]),
    ]);

    return {
      ...product,
      variants,
      suppliers,
      stockQuantity: quantities.get(productId) ?? 0,
    };
  }

  async create(
    companyId: string,
    input: CreateProductInput,
    userId?: string | null,
    options: {
      /** Transaction of the caller (offline ingestion): the product lives or dies with it. */
      tx?: Database;
      /** Idempotency key of a product created offline: a replay returns the same product. */
      clientUuid?: string | null;
    } = {}
  ): Promise<Product> {
    const run = async (tx: Database) => {
      const repository = catalogRepository.withTransaction(tx);

      if (options.clientUuid) {
        const existing = await repository.findByClientUuid(companyId, options.clientUuid);
        if (existing) return existing;
      }

      const product = await repository.insert({
        clientUuid: options.clientUuid ?? null,
        companyId,
        sku: input.sku?.trim() || (await repository.nextSku(companyId, input.isService)),
        name: input.name.trim(),
        description: input.description,
        categoryId: input.categoryId ?? null,
        // The unit default is resolved here (not in the Zod schema) so it follows the
        // request language.
        unit: input.unit?.trim() || tr("unit"),
        barcode: input.barcode,
        purchasePriceCents: input.purchasePriceCents,
        salePriceCents: input.salePriceCents,
        isService: input.isService,
        imageUrl: input.imageUrl ?? null,
        imageUrls: input.imageUrls,
        minStock: String(input.minStock),
      });

      if (input.variants.length > 0) {
        await repository.replaceVariants(
          tx,
          companyId,
          product.id,
          input.variants.map((variant) => ({
            sku: variant.sku,
            barcode: variant.barcode,
            attributes: variant.attributes,
            salePriceCents: variant.salePriceCents ?? null,
            isDefault: variant.isDefault,
          }))
        );
      }

      if (input.initialStock && !input.isService) {
        await inventoryApplication.applyMovement(tx, {
          companyId,
          productId: product.id,
          warehouseId: input.initialStock.warehouseId,
          movementType: "IN",
          quantity: input.initialStock.quantity,
          unitCostCents: input.initialStock.unitCostCents,
          originType: "manual",
          originId: product.id,
          reference: product.sku,
          reason: tr("Initial stock on product creation"),
          userId,
        });
      }

      return product;
    };
    return options.tx ? run(options.tx) : runInTransaction(run);
  }

  async update(companyId: string, productId: string, input: UpdateProductInput): Promise<Product> {
    return runInTransaction(async (tx) => {
      const repository = catalogRepository.withTransaction(tx);
      const existing = await repository.findById(companyId, productId);
      if (!existing) throw new NotFoundError("Product not found.");

      const { variants, minStock, ...patch } = input;
      const product = await repository.update(companyId, productId, {
        ...patch,
        // `minStock` arrives as a number or a string from the API; the `numeric` column
        // expects a string.
        ...(minStock != null ? { minStock: String(minStock) } : {}),
      });
      if (!product) throw new NotFoundError("Product not found.");

      if (variants) {
        await repository.replaceVariants(
          tx,
          companyId,
          productId,
          variants.map((variant) => ({
            sku: variant.sku,
            barcode: variant.barcode ?? "",
            attributes: variant.attributes ?? {},
            salePriceCents: variant.salePriceCents ?? null,
            isDefault: variant.isDefault ?? false,
          }))
        );
      }

      return product;
    });
  }

  async archive(companyId: string, productId: string): Promise<void> {
    const archived = await catalogRepository.archive(companyId, productId);
    if (!archived) throw new NotFoundError("Product not found.");
  }

  async findByBarcode(companyId: string, barcode: string): Promise<Product | null> {
    return catalogRepository.findByBarcode(companyId, barcode.trim());
  }

  /** Current sale price — used by documents and the POS. */
  async resolveSalePrice(companyId: string, productId: string): Promise<number> {
    const product = await catalogRepository.findById(companyId, productId);
    if (!product) throw new NotFoundError("Product not found.");
    return product.salePriceCents;
  }

  async counts(companyId: string) {
    return catalogRepository.counts(companyId);
  }

  async listForExport(companyId: string): Promise<ProductExportRow[]> {
    return catalogRepository.listForExport(companyId);
  }

  /**
   * Saves the rows of an Excel file, all or nothing: one row refused by the database
   * cancels the whole file, so it can be fixed and imported again without duplicates.
   *
   * A row updates the product with the same name, or creates one with an automatic
   * code: the code is never taken from the file.
   *
   * Categories are matched by name and created when missing. Stock is not imported:
   * quantities go through stock movements, never through the product sheet.
   */
  async importProducts(companyId: string, rows: ProductImportRow[]): Promise<ImportResult> {
    return runInTransaction(async (tx) => {
      const repository = catalogRepository.withTransaction(tx);
      const categoryRepository = categoriesRepository.withTransaction(tx);

      const matches = matchByName(
        rows,
        await repository.activeNames(companyId),
        "{count} products are already called « {name} »: rename them in the application first."
      );
      const categoryIds = new Map(
        (await categoryRepository.listAll(companyId)).map((category) => [
          category.name.trim().toLowerCase(),
          category.id,
        ])
      );

      const resolveCategory = async (name: string | undefined) => {
        if (name === undefined) return undefined;
        if (!name) return null;
        const key = name.toLowerCase();
        let id = categoryIds.get(key);
        if (!id) {
          id = (await categoryRepository.create(companyId, { name })).id;
          categoryIds.set(key, id);
        }
        return id;
      };

      const result: ImportResult = { created: 0, updated: 0 };
      for (const row of rows) {
        const { minStock, ...fields } = row.fields;
        const categoryId = await resolveCategory(row.categoryName);
        const values = {
          ...fields,
          name: fields.name.trim(),
          ...(minStock !== undefined ? { minStock: String(minStock) } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        };

        const existingId = matches.get(row);
        if (existingId) {
          await repository.update(companyId, existingId, {
            ...values,
            ...(fields.unit !== undefined ? { unit: fields.unit || tr("unit") } : {}),
          });
          result.updated += 1;
          continue;
        }

        await repository.insert({
          ...values,
          companyId,
          sku: await repository.nextSku(companyId, fields.isService ?? false),
          unit: fields.unit || tr("unit"),
        });
        result.created += 1;
      }
      return result;
    });
  }
}

export const catalogApplication = new CatalogApplication();
