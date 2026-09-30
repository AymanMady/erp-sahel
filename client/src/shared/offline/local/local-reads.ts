/**
 * Reads of the screens from the local database (offline-first desktop).
 *
 * Each function answers **exactly like the server endpoint it replaces** — same shape,
 * same filters, same search columns, same order, same page — so that a screen cannot
 * tell where its data came from. The server rules are quoted from the repositories
 * they mirror; change both together.
 *
 * `readLocalFirst` picks the source: the local database when every entity the answer
 * needs is ready (`replication.ts`), the former path otherwise (not downloaded yet,
 * stale, web application).
 */

import type {
  Category,
  Party,
  PartyDetail,
  PosRegister,
  ProductDetail,
  ProductListItem,
  Service,
  StockRow,
  Warehouse,
} from "@/entities/types";
import type { Paginated } from "@/entities/types";
import type { SyncTable } from "@shared/sync-protocol";
import { ApiError } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { localDb, type QuerySpec } from "./local-db";
import { isLocalReady } from "./replication";

type Row = Record<string, unknown>;

/** Server default page size (`tenant-repository.ts`). */
const DEFAULT_LIMIT = 50;

/**
 * Local answer when every entity it needs is ready, former path otherwise. A local
 * database closed during the read (company switch) also falls back.
 */
export async function readLocalFirst<T>(
  entities: SyncTable[],
  local: () => Promise<T>,
  remote: () => Promise<T>
): Promise<T> {
  if (!entities.every(isLocalReady)) return remote();
  try {
    return await local();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.warn("[local-db] local read failed, using the server", error);
    return remote();
  }
}

function notFound(message: string): ApiError {
  return new ApiError({ status: 404, code: "NOT_FOUND", message });
}

async function rows<T = Row>(spec: QuerySpec): Promise<{ items: T[]; total: number }> {
  const result = await localDb.query<T>(spec);
  return { items: result.rows.map((row) => row.data), total: result.total };
}

async function byId<T = Row>(entity: SyncTable, ids: string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const found = await localDb.get<T>(entity, unique);
  return new Map(found.map((row) => [row.id, row.data]));
}

const active = { column: "is_active", op: "eq" as const, value: true };

function term(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  return trimmed ? trimmed : undefined;
}

/** Quantities are numeric strings (`numeric(16,3)`): summed as numbers, like the server. */
async function stockByProduct(productIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (productIds.length === 0) return totals;
  const { items } = await rows<{ productId: string; quantity: string }>({
    entity: "stock_items",
    filters: [{ column: "product_id", op: "in", value: [...new Set(productIds)] }],
  });
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + Number(item.quantity || 0));
  }
  return totals;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export interface ProductFilters {
  search?: string;
  categoryId?: string | null;
  isService?: boolean | null;
  includeArchived?: boolean;
  withStock?: boolean;
  orderBy?: "name" | "sku" | "price" | "recent";
  limit?: number;
  offset?: number;
}

const PRODUCT_ORDER: Record<NonNullable<ProductFilters["orderBy"]>, QuerySpec["orderBy"]> = {
  name: [{ column: "name" }],
  sku: [{ column: "sku" }],
  price: [{ column: "json:salePriceCents" }],
  recent: [{ column: "json:createdAt", desc: true }],
};

/**
 * `GET /api/catalog/products` (`catalog/repository.ts` search): SKU, name and description
 * contain the term, **or** the barcode equals it; `{ items, total }` without paging keys.
 */
export async function listProductsLocal(
  filters: ProductFilters = {}
): Promise<{ items: ProductListItem[]; total: number }> {
  const search = term(filters.search);
  const page = await rows<ProductListItem>({
    entity: "products",
    filters: [
      ...(filters.includeArchived ? [] : [active]),
      ...(filters.categoryId
        ? [{ column: "category_id", op: "eq" as const, value: filters.categoryId }]
        : []),
      ...(filters.isService != null
        ? [{ column: "json:isService", op: "eq" as const, value: filters.isService }]
        : []),
    ],
    search: search
      ? { term: search, columns: ["sku", "name", "json:description"], exactColumns: ["barcode"] }
      : null,
    orderBy: PRODUCT_ORDER[filters.orderBy ?? "name"],
    limit: filters.limit ?? DEFAULT_LIMIT,
    offset: filters.offset ?? 0,
  });
  // A category is named even when archived (left join on the server).
  const categories = await byId<Category>(
    "categories",
    page.items.map((item) => String(item.categoryId ?? ""))
  );
  const stock = filters.withStock ? await stockByProduct(page.items.map((item) => item.id)) : null;
  return {
    total: page.total,
    items: page.items.map((item) => {
      const {
        variants: _variants,
        suppliers: _suppliers,
        ...product
      } = item as ProductListItem & Row;
      return {
        ...(product as ProductListItem),
        categoryName: item.categoryId ? (categories.get(item.categoryId)?.name ?? null) : null,
        ...(stock ? { stockQuantity: stock.get(item.id) ?? 0 } : {}),
      };
    }),
  };
}

/** `GET /api/catalog/products/:id`: active variants, active supplier links by name. */
export async function getProductLocal(id: string): Promise<ProductDetail> {
  const [row] = await localDb.get<Row>("products", [id]);
  if (!row) throw notFound(i18n.t("catalog:products.notFound"));
  const {
    variants = [],
    suppliers = [],
    ...product
  } = row.data as Row & {
    variants?: Row[];
    suppliers?: Row[];
  };
  const links = (suppliers as Row[]).filter((link) => link.isActive !== false);
  const parties = await byId<Party>(
    "parties",
    links.map((link) => String(link.supplierId))
  );
  const stock = await stockByProduct([id]);
  return {
    ...(product as unknown as ProductDetail),
    variants: (variants as Row[])
      .filter((variant) => variant.isActive !== false)
      .sort((a, b) =>
        String(a.sku).localeCompare(String(b.sku))
      ) as unknown as ProductDetail["variants"],
    suppliers: links
      .flatMap((link) => {
        const party = parties.get(String(link.supplierId));
        return party ? [{ link, supplierName: party.name, supplierCode: party.code }] : [];
      })
      .sort((a, b) =>
        a.supplierName.localeCompare(b.supplierName)
      ) as unknown as ProductDetail["suppliers"],
    stockQuantity: stock.get(id) ?? 0,
  };
}

/**
 * `GET /api/catalog/products/barcode/:code`: an active product with this barcode, else
 * the product of an active variant with it. The raw product row.
 */
export async function findByBarcodeLocal(barcode: string): Promise<ProductListItem> {
  const code = barcode.trim();
  const direct = await rows<ProductListItem>({
    entity: "products",
    filters: [active, { column: "barcode", op: "eq", value: code }],
    limit: 1,
  });
  if (direct.items[0]) return direct.items[0];
  const viaVariant = await rows<ProductListItem & { variants?: Row[] }>({
    entity: "products",
    filters: [{ column: "json:variants", op: "arrayHas", value: { key: "barcode", equals: code } }],
  });
  const product = viaVariant.items.find((item) =>
    (item.variants ?? []).some((variant) => variant.barcode === code && variant.isActive !== false)
  );
  if (!product) {
    throw notFound(i18n.t("catalog:products.barcodeNotFound"));
  }
  return product;
}

/** `GET /api/catalog/categories`: active, by name, not paged. */
export async function listCategoriesLocal(): Promise<Category[]> {
  return (
    await rows<Category>({ entity: "categories", filters: [active], orderBy: [{ column: "name" }] })
  ).items;
}

// ─── Parties ──────────────────────────────────────────────────────────────────

export interface PartyFilters {
  search?: string;
  partyType?: string | null;
  role?: "CUSTOMER" | "SUPPLIER" | null;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * `GET /api/parties`. With `role` (`listByRole`): active only, the role or `BOTH`,
 * search on name, code, phone, by name, 100 at most, `total` = rows returned. Without:
 * search on code, name, email, phone, tax id, newest first, paged.
 */
export async function listPartiesLocal(filters: PartyFilters = {}): Promise<Paginated<Party>> {
  const search = term(filters.search);
  if (filters.role) {
    const limit = filters.limit ?? 100;
    const { items } = await rows<Party>({
      entity: "parties",
      filters: [active, { column: "party_type", op: "in", value: [filters.role, "BOTH"] }],
      search: search ? { term: search, columns: ["name", "code", "json:phone"] } : null,
      orderBy: [{ column: "name" }],
      limit,
    });
    return { items, total: items.length, limit: filters.limit ?? items.length, offset: 0 };
  }
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, 200);
  const offset = filters.offset ?? 0;
  const page = await rows<Party>({
    entity: "parties",
    filters: [
      ...(filters.includeArchived ? [] : [active]),
      ...(filters.partyType
        ? [{ column: "party_type", op: "eq" as const, value: filters.partyType }]
        : []),
    ],
    search: search
      ? { term: search, columns: ["code", "name", "json:email", "json:phone", "json:taxId"] }
      : null,
    orderBy: [{ column: "json:createdAt", desc: true }],
    limit,
    offset,
  });
  return { ...page, limit, offset };
}

/**
 * `GET /api/parties/:id` (`parties/repository.ts`): active contacts by last name, active
 * addresses, the last 50 invoices and payments, and what the customer still owes on
 * validated invoices. Needs invoices and payments downloaded too (`readLocalFirst`).
 */
export async function getPartyLocal(id: string): Promise<PartyDetail> {
  const [row] = await localDb.get<Row>("parties", [id]);
  if (!row) throw notFound(i18n.t("parties:notFound"));
  const {
    contacts = [],
    addresses = [],
    ...party
  } = row.data as Row & {
    contacts?: Row[];
    addresses?: Row[];
  };
  const invoices = await rows<Row>({
    entity: "sales_invoices",
    filters: [{ column: "party_id", op: "eq", value: id }],
    orderBy: [{ column: "date", desc: true }],
  });
  const payments = await rows<Row>({
    entity: "payments",
    filters: [{ column: "party_id", op: "eq", value: id }],
    orderBy: [{ column: "date", desc: true }],
    limit: 50,
  });
  const outstandingCents = invoices.items
    .filter((invoice) => invoice.status === "VALIDATED" || invoice.status === "PARTIALLY_PAID")
    .reduce(
      (sum, invoice) =>
        sum +
        Math.max(
          Number(invoice.totalCents ?? 0) -
            Number(invoice.paidAmountCents ?? 0) -
            Number(invoice.creditedAmountCents ?? 0),
          0
        ),
      0
    );
  return {
    ...(party as unknown as Party),
    contacts: (contacts as Row[])
      .filter((contact) => contact.isActive !== false)
      .sort((a, b) =>
        String(a.lastName).localeCompare(String(b.lastName))
      ) as unknown as PartyDetail["contacts"],
    addresses: (addresses as Row[]).filter(
      (address) => address.isActive !== false
    ) as unknown as PartyDetail["addresses"],
    history: {
      invoices: invoices.items.slice(0, 50).map((invoice) => ({
        id: String(invoice.id),
        number: String(invoice.number),
        date: String(invoice.date),
        status: String(invoice.status),
        totalCents: Number(invoice.totalCents),
        paidAmountCents: Number(invoice.paidAmountCents),
        creditedAmountCents: Number(invoice.creditedAmountCents ?? 0),
      })),
      payments: payments.items.map((payment) => ({
        id: String(payment.id),
        number: String(payment.number),
        paymentDate: String(payment.paymentDate),
        amountCents: Number(payment.amountCents),
        paymentMethod: String(payment.paymentMethod),
        direction: String(payment.direction),
        invoiceId: (payment.invoiceId as string | null) ?? null,
      })),
    },
    outstandingCents,
  };
}

// ─── Services, warehouses, stock ──────────────────────────────────────────────

/** `GET /api/services`: active, search on code, name, description, by name, paged. */
export async function listServicesLocal(
  filters: { search?: string; limit?: number; offset?: number } = {}
): Promise<Paginated<Service>> {
  const search = term(filters.search);
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, 200);
  const offset = filters.offset ?? 0;
  const page = await rows<Service>({
    entity: "services",
    filters: [active],
    search: search ? { term: search, columns: ["code", "name", "json:description"] } : null,
    orderBy: [{ column: "name" }],
    limit,
    offset,
  });
  return { ...page, limit, offset };
}

/** `GET /api/warehouses`: active, by name. */
export async function listWarehousesLocal(): Promise<Warehouse[]> {
  return (
    await rows<Warehouse>({
      entity: "warehouses",
      filters: [active],
      orderBy: [{ column: "json:name" }],
    })
  ).items;
}

export interface StockFilters {
  warehouseId?: string | null;
  productId?: string | null;
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * `GET /api/inventory/stock` (`inventory/repository.ts`): every stock line with its
 * product and warehouse — archived ones included —, name, SKU or barcode containing
 * the term, "low" judged line by line (`quantity <= minStock`), by product name.
 */
export async function listStockLocal(
  filters: StockFilters = {}
): Promise<{ items: StockRow[]; total: number }> {
  const search = term(filters.search)?.toLowerCase();
  let productIds: string[] | null = filters.productId ? [filters.productId] : null;
  if (search) {
    const matching = await localDb.query({
      entity: "products",
      search: { term: search, columns: ["name", "sku", "barcode"] },
      includeDeleted: true,
    });
    const ids = matching.rows.map((row) => row.id);
    productIds = productIds ? productIds.filter((id) => ids.includes(id)) : ids;
  }
  const lines = await rows<Row>({
    entity: "stock_items",
    filters: [
      ...(filters.warehouseId
        ? [{ column: "warehouse_id", op: "eq" as const, value: filters.warehouseId }]
        : []),
      ...(productIds ? [{ column: "product_id", op: "in" as const, value: productIds }] : []),
    ],
  });
  const products = await byId<Row>(
    "products",
    lines.items.map((line) => String(line.productId))
  );
  const warehouses = await byId<Row>(
    "warehouses",
    lines.items.map((line) => String(line.warehouseId))
  );
  const joined = lines.items.flatMap((line) => {
    const product = products.get(String(line.productId));
    const warehouse = warehouses.get(String(line.warehouseId));
    if (!product || !warehouse) return [];
    const minStock = String(product.minStock ?? "0");
    if (filters.lowStockOnly && Number(line.quantity) > Number(minStock)) return [];
    return [
      {
        ...(line as unknown as StockRow),
        productSku: String(product.sku),
        productName: String(product.name),
        productUnit: String(product.unit),
        warehouseName: String(warehouse.name),
        minStock,
      },
    ];
  });
  joined.sort((a, b) => a.productName.localeCompare(b.productName));
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? DEFAULT_LIMIT;
  return { items: joined.slice(offset, offset + limit), total: joined.length };
}

/**
 * `GET /api/inventory/low-stock`: active stocked products with a threshold, whose stock
 * all warehouses together is at or below it; 50 at most.
 */
export async function lowStockLocal(): Promise<
  { productId: string; sku: string; name: string; minStock: string; quantity: string }[]
> {
  const { items } = await rows<Row>({
    entity: "products",
    filters: [
      active,
      { column: "json:isService", op: "eq", value: false },
      { column: "json:minStock", op: "gt", value: 0 },
    ],
  });
  const stock = await stockByProduct(items.map((item) => String(item.id)));
  return items
    .filter((item) => (stock.get(String(item.id)) ?? 0) <= Number(item.minStock))
    .slice(0, 50)
    .map((item) => ({
      productId: String(item.id),
      sku: String(item.sku),
      name: String(item.name),
      minStock: String(item.minStock),
      quantity: String(stock.get(String(item.id)) ?? 0),
    }));
}

// ─── Till ─────────────────────────────────────────────────────────────────────

/** `GET /api/pos/registers`: active, by name. */
export async function listRegistersLocal(): Promise<PosRegister[]> {
  return (
    await rows<PosRegister>({
      entity: "pos_registers",
      filters: [active],
      orderBy: [{ column: "json:name" }],
    })
  ).items;
}

/** `GET /api/banking/payment-accounts`: active, by name, without bank details. */
export async function listPaymentAccountsLocal(): Promise<
  { id: string; code: string; name: string; accountType: string; isDefault: boolean }[]
> {
  const { items } = await rows<Row>({
    entity: "bank_accounts",
    filters: [active],
    orderBy: [{ column: "json:name" }],
  });
  return items.map((item) => ({
    id: String(item.id),
    code: String(item.code),
    name: String(item.name),
    accountType: String(item.accountType),
    isDefault: Boolean(item.isDefault),
  }));
}
