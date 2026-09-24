/** Persistence of the generic catalog (products, variants, categories, suppliers). */

import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";

import {
  categories,
  productSuppliers,
  productVariants,
  products,
  parties,
  type Product,
  type ProductVariant,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const categoriesRepository = new TenantRepository(categories, [categories.name]);
export const productVariantsRepository = new TenantRepository(productVariants, [
  productVariants.sku,
  productVariants.barcode,
]);

export interface ProductSearchOptions {
  search?: string;
  categoryId?: string | null;
  isService?: boolean | null;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: "name" | "sku" | "price" | "recent";
}

export class CatalogRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): CatalogRepository {
    return new CatalogRepository(tx);
  }

  private searchConditions(companyId: string, options: ProductSearchOptions): SQL {
    const conditions: (SQL | undefined)[] = [
      eq(products.companyId, companyId),
      options.includeArchived ? undefined : eq(products.isActive, true),
      options.categoryId ? eq(products.categoryId, options.categoryId) : undefined,
      options.isService == null ? undefined : eq(products.isService, options.isService),
    ];

    if (options.search) {
      const pattern = `%${options.search.trim()}%`;
      // Barcode search must be an exact match so a scan does not return neighbouring
      // codes; the other fields use "contains".
      conditions.push(
        or(
          sql`${products.sku} ilike ${pattern}`,
          sql`${products.name} ilike ${pattern}`,
          sql`${products.description} ilike ${pattern}`,
          eq(products.barcode, options.search.trim())
        )
      );
    }
    return and(...conditions.filter(Boolean)) as SQL;
  }

  private orderClause(orderBy: ProductSearchOptions["orderBy"]) {
    switch (orderBy) {
      case "sku":
        return asc(products.sku);
      case "price":
        return asc(products.salePriceCents);
      case "recent":
        return sql`${products.createdAt} desc`;
      default:
        return asc(products.name);
    }
  }

  async search(
    companyId: string,
    options: ProductSearchOptions = {}
  ): Promise<{ items: (Product & { categoryName: string | null })[]; total: number }> {
    const where = this.searchConditions(companyId, options);
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ product: products, categoryName: categories.name })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(where)
        .orderBy(this.orderClause(options.orderBy))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(products)
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.product, categoryName: row.categoryName })),
      total: countRow?.value ?? 0,
    };
  }

  async findById(companyId: string, productId: string): Promise<Product | null> {
    const [row] = await this.database
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
      .limit(1);
    return row ?? null;
  }

  async findBySku(companyId: string, sku: string): Promise<Product | null> {
    const [row] = await this.database
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyId), eq(products.sku, sku)))
      .limit(1);
    return row ?? null;
  }

  /** Resolves a scan: product barcode first, then variant barcode. */
  async findByBarcode(companyId: string, barcode: string): Promise<Product | null> {
    const [direct] = await this.database
      .select()
      .from(products)
      .where(
        and(
          eq(products.companyId, companyId),
          eq(products.isActive, true),
          eq(products.barcode, barcode)
        )
      )
      .limit(1);
    if (direct) return direct;

    const [viaVariant] = await this.database
      .select({ product: products })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.companyId, companyId), eq(productVariants.barcode, barcode)))
      .limit(1);
    return viaVariant?.product ?? null;
  }

  async insert(values: typeof products.$inferInsert): Promise<Product> {
    const [row] = await this.database.insert(products).values(values).returning();
    return row;
  }

  async update(
    companyId: string,
    productId: string,
    patch: Partial<typeof products.$inferInsert>
  ): Promise<Product | null> {
    const [row] = await this.database
      .update(products)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
      .returning();
    return row ?? null;
  }

  async archive(companyId: string, productId: string): Promise<boolean> {
    const rows = await this.database
      .update(products)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
      .returning({ id: products.id });
    return rows.length > 0;
  }

  async listVariants(companyId: string, productId: string): Promise<ProductVariant[]> {
    return this.database
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.companyId, companyId), eq(productVariants.productId, productId))
      )
      .orderBy(asc(productVariants.sku));
  }

  async replaceVariants(
    tx: Database,
    companyId: string,
    productId: string,
    variants: Omit<typeof productVariants.$inferInsert, "companyId" | "productId">[]
  ): Promise<void> {
    await tx
      .delete(productVariants)
      .where(
        and(eq(productVariants.companyId, companyId), eq(productVariants.productId, productId))
      );
    if (variants.length === 0) return;
    await tx
      .insert(productVariants)
      .values(variants.map((variant) => ({ ...variant, companyId, productId })));
  }

  /** Suppliers listed for a product, with their purchase price ([FR-ACH-1]). */
  async listProductSuppliers(companyId: string, productId: string) {
    return this.database
      .select({
        link: productSuppliers,
        supplierName: parties.name,
        supplierCode: parties.code,
      })
      .from(productSuppliers)
      .innerJoin(parties, eq(parties.id, productSuppliers.supplierId))
      .where(
        and(
          eq(productSuppliers.companyId, companyId),
          eq(productSuppliers.productId, productId),
          eq(productSuppliers.isActive, true)
        )
      )
      .orderBy(asc(parties.name));
  }

  async upsertProductSupplier(
    companyId: string,
    values: Omit<typeof productSuppliers.$inferInsert, "companyId">
  ) {
    const [row] = await this.database
      .insert(productSuppliers)
      .values({ ...values, companyId })
      .onConflictDoUpdate({
        target: [productSuppliers.productId, productSuppliers.supplierId],
        set: {
          supplierRef: values.supplierRef ?? "",
          purchasePriceCents: values.purchasePriceCents ?? 0,
          leadTimeDays: values.leadTimeDays ?? 0,
          originCountryCode: values.originCountryCode ?? "",
          isPreferred: values.isPreferred ?? false,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async removeProductSupplier(
    companyId: string,
    productId: string,
    supplierId: string
  ): Promise<void> {
    await this.database
      .delete(productSuppliers)
      .where(
        and(
          eq(productSuppliers.companyId, companyId),
          eq(productSuppliers.productId, productId),
          eq(productSuppliers.supplierId, supplierId)
        )
      );
  }

  /** Dashboard counters. */
  async counts(companyId: string) {
    const [row] = await this.database
      .select({
        total: sql<number>`count(*) filter (where ${products.isActive})::int`,
        services: sql<number>`count(*) filter (where ${products.isActive} and ${products.isService})::int`,
      })
      .from(products)
      .where(eq(products.companyId, companyId));
    return { total: row?.total ?? 0, services: row?.services ?? 0 };
  }
}

export const catalogRepository = new CatalogRepository();
