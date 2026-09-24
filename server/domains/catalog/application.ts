/**
 * Cas d'usage du catalogue.
 *
 * Le catalogue est générique : un même produit sert n'importe quel commerce. Cette
 * couche enrichit les listes avec le stock, qui appartient au domaine `inventory` et
 * n'est donc lu que par son application.
 */

import type { Product } from "@shared/schema";
import { runInTransaction } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { inventoryApplication } from "../inventory/application";
import { catalogRepository, type ProductSearchOptions } from "./repository";
import type { CreateProductInput, UpdateProductInput } from "./schemas";

export interface ProductListItem extends Product {
  categoryName: string | null;
  /** Solde tous magasins confondus ; absent si `withStock` n'est pas demandé. */
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
    if (!product) throw new NotFoundError("Produit introuvable.");

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
        unit: input.unit,
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
          reason: "Stock initial à la création du produit",
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
      if (!existing) throw new NotFoundError("Produit introuvable.");

      const { variants, minStock, ...patch } = input;
      const product = await repository.update(companyId, productId, {
        ...patch,
        // `minStock` arrive en nombre ou en chaîne côté API ; la colonne `numeric`
        // attend une chaîne.
        ...(minStock != null ? { minStock: String(minStock) } : {}),
      });
      if (!product) throw new NotFoundError("Produit introuvable.");

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
    if (!archived) throw new NotFoundError("Produit introuvable.");
  }

  async findByBarcode(companyId: string, barcode: string): Promise<Product | null> {
    return catalogRepository.findByBarcode(companyId, barcode.trim());
  }

  /** Prix de vente courant — utilisé par les documents et le POS. */
  async resolveSalePrice(companyId: string, productId: string): Promise<number> {
    const product = await catalogRepository.findById(companyId, productId);
    if (!product) throw new NotFoundError("Produit introuvable.");
    return product.salePriceCents;
  }

  async counts(companyId: string) {
    return catalogRepository.counts(companyId);
  }
}

export const catalogApplication = new CatalogApplication();
