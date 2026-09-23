/**
 * Cas d'usage du catalogue.
 *
 * Deux responsabilités qui justifient cette couche :
 *  1. composer le produit générique avec le **profil du module** actif, sans jamais
 *     importer le code d'un module ([BR-11], [BR-17]) — la composition passe par
 *     `pluginRegistry.profileExtensionFor` ;
 *  2. enrichir les listes avec le stock, qui appartient au domaine `inventory` et
 *     n'est donc lu que par son application.
 */

import { and } from "drizzle-orm";

import type { Product } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { inventoryApplication } from "../inventory/application";
import { pluginRegistry } from "../plugins/registry";
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
  /** Profil métier du module correspondant à `profileType`, s'il existe. */
  profile: unknown | null;
  stockQuantity: number;
}

class CatalogApplication {
  /** Vérifie qu'un module est activé avant d'accepter un profil qui en dépend ([BR-12]). */
  private async assertProfileAllowed(
    companyId: string,
    profileType: string,
    database: Database
  ): Promise<void> {
    if (profileType === "GENERIC") return;
    const extension = pluginRegistry.profileExtensionFor(profileType);
    if (!extension) {
      throw new BusinessRuleError(`Aucun module ne gère le profil « ${profileType} ».`);
    }
    const plugin = pluginRegistry
      .list()
      .find((candidate) => candidate.productProfile?.profileType === profileType);
    if (plugin && !(await pluginRegistry.isEnabled(companyId, plugin.meta.code, database))) {
      throw new BusinessRuleError(
        `Le module « ${plugin.meta.name} » n'est pas activé pour cette société.`,
        "MODULE_DISABLED"
      );
    }
  }

  async search(
    companyId: string,
    options: ProductSearchOptions & {
      withStock?: boolean;
      moduleQuery?: Record<string, unknown>;
    } = {}
  ): Promise<{ items: ProductListItem[]; total: number }> {
    // Chaque module actif peut restreindre la recherche selon ses propres critères.
    let moduleFilter = options.moduleFilter;
    if (options.moduleQuery) {
      for (const plugin of pluginRegistry.list()) {
        const filter = plugin.productProfile?.buildSearchFilter?.(companyId, options.moduleQuery);
        if (filter) {
          // Les filtres de plusieurs modules se cumulent : un produit doit satisfaire
          // tous les critères saisis, quel que soit le module qui les porte.
          moduleFilter = moduleFilter ? (and(moduleFilter, filter) as typeof filter) : filter;
        }
      }
    }

    const result = await catalogRepository.search(companyId, { ...options, moduleFilter });
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

    const extension = pluginRegistry.profileExtensionFor(product.profileType);
    const [variants, suppliers, profiles, quantities] = await Promise.all([
      catalogRepository.listVariants(companyId, productId),
      catalogRepository.listProductSuppliers(companyId, productId),
      extension ? extension.load(db, companyId, [productId]) : Promise.resolve(new Map()),
      inventoryApplication.quantitiesByProduct(companyId, [productId]),
    ]);

    return {
      ...product,
      variants,
      suppliers,
      profile: profiles.get(productId) ?? null,
      stockQuantity: quantities.get(productId) ?? 0,
    };
  }

  async create(
    companyId: string,
    input: CreateProductInput,
    userId?: string | null
  ): Promise<Product> {
    return runInTransaction(async (tx) => {
      await this.assertProfileAllowed(companyId, input.profileType, tx);
      const repository = catalogRepository.withTransaction(tx);

      const product = await repository.insert({
        companyId,
        profileType: input.profileType,
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

      const extension = pluginRegistry.profileExtensionFor(input.profileType);
      if (extension && input.profile) {
        await extension.save(tx, companyId, product.id, input.profile);
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

      const profileType = input.profileType ?? existing.profileType;
      if (input.profileType && input.profileType !== existing.profileType) {
        await this.assertProfileAllowed(companyId, input.profileType, tx);
      }

      const { variants, profile, minStock, ...patch } = input;
      const product = await repository.update(companyId, productId, {
        ...patch,
        // `minStock` arrive en nombre ou en chaîne côté API ; la colonne `numeric`
        // attend une chaîne.
        ...(minStock != null ? { minStock: String(minStock) } : {}),
        profileType,
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

      const extension = pluginRegistry.profileExtensionFor(profileType);
      if (extension && profile) {
        await extension.save(tx, companyId, productId, profile);
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
