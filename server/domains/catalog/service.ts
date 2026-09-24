/** Frontière applicative du catalogue : validation, normalisation, délégation. */

import { asc } from "drizzle-orm";

import { categories } from "@shared/schema";
import { NotFoundError } from "../../shared/errors/app-error";
import { catalogApplication } from "./application";
import { catalogRepository, categoriesRepository } from "./repository";
import {
  createCategorySchema,
  createProductSchema,
  idParamSchema,
  productSearchQuerySchema,
  productSupplierSchema,
  updateCategorySchema,
  updateProductSchema,
} from "./schemas";

export class CatalogService {
  async searchProducts(companyId: string, query: unknown) {
    const parsed = productSearchQuerySchema.parse(query ?? {});
    return catalogApplication.search(companyId, parsed);
  }

  async getProduct(companyId: string, id: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    return catalogApplication.getDetail(companyId, productId);
  }

  async findByBarcode(companyId: string, barcode: string) {
    const product = await catalogApplication.findByBarcode(companyId, barcode);
    if (!product) throw new NotFoundError("Aucun produit ne correspond à ce code-barres.");
    return product;
  }

  async createProduct(companyId: string, body: unknown, userId?: string | null) {
    return catalogApplication.create(companyId, createProductSchema.parse(body), userId);
  }

  async updateProduct(companyId: string, id: unknown, body: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    return catalogApplication.update(companyId, productId, updateProductSchema.parse(body));
  }

  async archiveProduct(companyId: string, id: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    await catalogApplication.archive(companyId, productId);
    return { success: true as const };
  }

  async listCategories(companyId: string) {
    return categoriesRepository.listAll(companyId, { orderBy: [asc(categories.name)] });
  }

  async createCategory(companyId: string, body: unknown) {
    return categoriesRepository.create(companyId, createCategorySchema.parse(body));
  }

  async updateCategory(companyId: string, id: unknown, body: unknown) {
    const { id: categoryId } = idParamSchema.parse({ id });
    const category = await categoriesRepository.update(
      companyId,
      categoryId,
      updateCategorySchema.parse(body)
    );
    if (!category) throw new NotFoundError("Catégorie introuvable.");
    return category;
  }

  async archiveCategory(companyId: string, id: unknown) {
    const { id: categoryId } = idParamSchema.parse({ id });
    const archived = await categoriesRepository.archive(companyId, categoryId);
    if (!archived) throw new NotFoundError("Catégorie introuvable.");
    return { success: true as const };
  }

  async listProductSuppliers(companyId: string, id: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    return catalogRepository.listProductSuppliers(companyId, productId);
  }

  async upsertProductSupplier(companyId: string, id: unknown, body: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    const data = productSupplierSchema.parse(body);
    return catalogRepository.upsertProductSupplier(companyId, { ...data, productId });
  }

  async removeProductSupplier(companyId: string, id: unknown, supplierId: unknown) {
    const { id: productId } = idParamSchema.parse({ id });
    const { id: resolvedSupplierId } = idParamSchema.parse({ id: supplierId });
    await catalogRepository.removeProductSupplier(companyId, productId, resolvedSupplierId);
    return { success: true as const };
  }
}

export const catalogService = new CatalogService();
