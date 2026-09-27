/**
 * Building the lines of a commercial document.
 *
 * Single entry point for quotes, orders, invoices, credit notes and POS tickets: prices
 * and countries of origin are **resolved server-side** from the catalog, never
 * taken as-is from the client. An offline terminal may therefore propose a price, but
 * the server has the final say — exactly the asymmetry described in `SYNC_STRATEGY.md`
 * §1 ("the client produces intents").
 */

import { and, eq, inArray } from "drizzle-orm";

import { computeDocumentTotals, type PricingLineInput } from "@shared/pricing";
import { products, services, type Company } from "@shared/schema";
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
  originCountry?: string;
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
  originCountry: string;
}

export interface BuiltDocument {
  lines: BuiltDocumentLine[];
  totalCents: number;
}

export interface BuildDocumentOptions {
  globalDiscountBp?: number;
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

  const productById = new Map(productRows.map((row) => [row.id, row]));
  const serviceById = new Map(serviceRows.map((row) => [row.id, row]));

  const resolved = rawLines.map((line, index) => {
    const product = line.productId ? productById.get(line.productId) : undefined;
    const service = line.serviceId ? serviceById.get(line.serviceId) : undefined;

    if (line.productId && !product) {
      throw new BusinessRuleError(
        tr("Line {line}: product not found or belongs to another company.", { line: index + 1 })
      );
    }
    if (line.serviceId && !service) {
      throw new BusinessRuleError(tr("Line {line}: service not found.", { line: index + 1 }));
    }

    const description = (line.description ?? product?.name ?? service?.name ?? "").trim();
    if (!description) {
      throw new ValidationError(
        tr("Line {line}: the description is required.", { line: index + 1 })
      );
    }

    const unitPriceCents =
      line.unitPriceCents ?? product?.salePriceCents ?? service?.priceCents ?? 0;

    return {
      raw: line,
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
      originCountry: entry.raw.originCountry ?? "",
    };
  });

  return {
    lines,
    totalCents: totals.totalCents,
  };
}
