/**
 * Catalog use cases.
 *
 * The catalog is generic: the same product serves any kind of business. This layer
 * enriches lists with stock levels, which belong to the `inventory` domain and are
 * therefore only read through its application layer.
 */

import type { Product } from "@shared/schema";
import { runInTransaction } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { inventoryApplication } from "../inventory/application";
import { catalogRepository, type ProductSearchOptions } from "./repository";
import type { CreateProductInput, UpdateProductInput } from "./schemas";

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
    userId?: string | null
  ): Promise<Product> {
    return runInTransaction(async (tx) => {
      const repository = catalogRepository.withTransaction(tx);

      const product = await repository.insert({
        companyId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description,
        categoryId: input.categoryId ?? null,
        // The unit default is resolved here (not in the Zod schema) so it follows the
        // request language.
        unit: input.unit?.trim() || tr("unit"),
        barcode: input.barcode,
        purchasePriceCents: input.purchasePriceCents,
        salePriceCents: input.salePriceCents,
        vatRateBp: input.vatRateBp,
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
    });
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
}

export const catalogApplication = new CatalogApplication();
