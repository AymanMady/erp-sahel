/**
 * Building the lines of a commercial document.
 *
 * Single entry point for quotes, orders, invoices and POS tickets: prices are **resolved
 * server-side** from the catalog, never taken as-is from the client. An offline terminal
 * may therefore propose a price, but the server has the final say — exactly the asymmetry described in `SYNC_STRATEGY.md`
 * §1 ("the client produces intents").
 */

import { and, eq, inArray } from "drizzle-orm";

import { computeDocumentTotals, type PricingLineInput } from "@shared/pricing";
import { productVariants, products, services, type Company } from "@shared/schema";
import type { Database } from "../../db";
import { BusinessRuleError, ValidationError } from "../errors/app-error";
import { tr } from "../i18n";

/** Line as received from the API or from a sync operation. */
export interface RawDocumentLine {
  productId?: string | null;
  variantId?: string | null;
  serviceId?: string | null;
  description?: string;
  productSku?: string;
  quantity: number | string;
  unit?: string;
  /** Proposed price; the catalog price applies when omitted. */
  unitPriceCents?: number | null;
  discountBp?: number;
}

export interface BuiltDocumentLine {
  productId: string | null;
  variantId: string | null;
  serviceId: string | null;
  productSku: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  discountBp: number;
  totalCents: number;
  position: number;
}

export interface BuiltDocument {
  lines: BuiltDocumentLine[];
  totalCents: number;
}

export interface BuildDocumentOptions {
  globalDiscountBp?: number;
  /** Catalog price used when a line has none: sale price (default) or purchase price. */
  priceList?: "sale" | "purchase";
  /**
   * Whether the caller may sell a catalog item at another price than the catalog one.
   * Internal callers are trusted (default `true`); the HTTP routes and the offline
   * ingestion pass the person's right (see `canSetPrices`).
   */
  allowPriceOverride?: boolean;
  /**
   * Moment the prices were read on the device (offline sale). A catalog price changed
   * after that moment explains a different price and is not an override.
   */
  pricedAt?: Date | null;
}

/** Upper bounds that no real document reaches: they stop absurd input early. */
const MAX_QUANTITY = 1_000_000_000;
const MAX_UNIT_PRICE_CENTS = 10_000_000_000_000;

/** Strict reading of a quantity: "abc" or "3abc" is refused, not read as 0 or 3. */
function readQuantity(value: number | string, line: number): number {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_QUANTITY) {
    throw new ValidationError(
      tr("Line {line}: the quantity must be a number greater than zero.", { line })
    );
  }
  return parsed;
}

/**
 * Resolves the lines against the catalog, then applies `computeDocumentTotals`.
 * Rejects a line where neither the product, the service nor the description identifies
 * what is being sold: an unreadable invoice is not an invoice.
 */
export async function buildDocumentLines(
  tx: Database,
  company: Pick<Company, "id">,
  rawLines: RawDocumentLine[],
  options: BuildDocumentOptions = {}
): Promise<BuiltDocument> {
  if (rawLines.length === 0) {
    throw new ValidationError("The document must have at least one line.");
  }

  const productIds = [...new Set(rawLines.map((l) => l.productId).filter(Boolean))] as string[];
  const serviceIds = [...new Set(rawLines.map((l) => l.serviceId).filter(Boolean))] as string[];
  const variantIds = [...new Set(rawLines.map((l) => l.variantId).filter(Boolean))] as string[];

  // **Sequential** queries rather than `Promise.all`: `tx` is bound to a single
  // PostgreSQL connection, on which two concurrent queries would step on each other
  // (`pg` warning "client is already executing a query").
  const productRows =
    productIds.length > 0
      ? await tx
          .select()
          .from(products)
          .where(and(eq(products.companyId, company.id), inArray(products.id, productIds)))
      : [];
  const serviceRows =
    serviceIds.length > 0
      ? await tx
          .select()
          .from(services)
          .where(and(eq(services.companyId, company.id), inArray(services.id, serviceIds)))
      : [];
  const variantRows =
    variantIds.length > 0
      ? await tx
          .select()
          .from(productVariants)
          .where(
            and(eq(productVariants.companyId, company.id), inArray(productVariants.id, variantIds))
          )
      : [];

  const productById = new Map(productRows.map((row) => [row.id, row]));
  const serviceById = new Map(serviceRows.map((row) => [row.id, row]));
  const variantById = new Map(variantRows.map((row) => [row.id, row]));
  const priceList = options.priceList ?? "sale";
  const allowPriceOverride = options.allowPriceOverride ?? true;

  const resolved = rawLines.map((line, index) => {
    const position = index + 1;
    const product = line.productId ? productById.get(line.productId) : undefined;
    const service = line.serviceId ? serviceById.get(line.serviceId) : undefined;
    const variant = line.variantId ? variantById.get(line.variantId) : undefined;

    if (line.productId && !product) {
      throw new BusinessRuleError(
        tr("Line {line}: product not found or belongs to another company.", { line: position })
      );
    }
    if (line.serviceId && !service) {
      throw new BusinessRuleError(tr("Line {line}: service not found.", { line: position }));
    }
    if (line.variantId && (!variant || variant.productId !== line.productId)) {
      throw new BusinessRuleError(
        tr("Line {line}: this model does not belong to the chosen product.", { line: position })
      );
    }
    // An archived item is no longer sold (it can still be bought back from a supplier).
    if (
      priceList === "sale" &&
      (product?.isActive === false || service?.isActive === false || variant?.isActive === false)
    ) {
      throw new BusinessRuleError(
        tr("Line {line}: {item} is no longer sold.", {
          line: position,
          item: product?.name ?? service?.name ?? "",
        })
      );
    }

    const quantity = readQuantity(line.quantity, position);
    if (
      line.unitPriceCents != null &&
      (!Number.isInteger(line.unitPriceCents) ||
        line.unitPriceCents < 0 ||
        line.unitPriceCents > MAX_UNIT_PRICE_CENTS)
    ) {
      throw new ValidationError(
        tr("Line {line}: the price must be zero or more.", { line: position })
      );
    }

    const description = (line.description ?? product?.name ?? service?.name ?? "").trim();
    if (!description) {
      throw new ValidationError(
        tr("Line {line}: the description is required.", { line: position })
      );
    }

    const catalogPriceCents =
      priceList === "purchase"
        ? (product?.purchasePriceCents ?? null)
        : (variant?.salePriceCents ?? product?.salePriceCents ?? service?.priceCents ?? null);

    // Selling a catalog item below or above its price is a manager's decision.
    if (
      priceList === "sale" &&
      !allowPriceOverride &&
      catalogPriceCents != null &&
      line.unitPriceCents != null &&
      line.unitPriceCents !== catalogPriceCents
    ) {
      const changedAfterSale =
        options.pricedAt != null &&
        [product?.updatedAt, variant?.updatedAt, service?.updatedAt].some(
          (updatedAt) => updatedAt != null && updatedAt > (options.pricedAt as Date)
        );
      if (!changedAfterSale) {
        throw new BusinessRuleError(
          tr("Line {line}: you are not allowed to change the price of {item}.", {
            line: position,
            item: description,
          }),
          "PRICE_OVERRIDE_FORBIDDEN"
        );
      }
    }

    const unitPriceCents = line.unitPriceCents ?? catalogPriceCents ?? 0;

    return {
      raw: { ...line, quantity },
      product,
      service,
      description,
      unitPriceCents,
    };
  });

  const totals = computeDocumentTotals(
    resolved.map<PricingLineInput>((entry) => ({
      quantity: entry.raw.quantity,
      unitPriceCents: entry.unitPriceCents,
      discountBp: entry.raw.discountBp ?? 0,
    })),
    { globalDiscountBp: options.globalDiscountBp }
  );

  const lines: BuiltDocumentLine[] = resolved.map((entry, index) => {
    const computed = totals.lines[index];
    return {
      productId: entry.raw.productId ?? null,
      variantId: entry.raw.variantId ?? null,
      serviceId: entry.raw.serviceId ?? null,
      productSku: entry.raw.productSku || entry.product?.sku || entry.service?.code || "",
      description: entry.description,
      quantity: computed.quantity.toFixed(3),
      unit: entry.raw.unit || entry.product?.unit || tr("unit"),
      unitPriceCents: computed.unitPriceCents,
      discountBp: computed.discountBp,
      totalCents: computed.totalCents,
      position: index,
    };
  });

  return {
    lines,
    totalCents: totals.totalCents,
  };
}
