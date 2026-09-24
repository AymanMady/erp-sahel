/**
 * Construction des lignes d'un document commercial.
 *
 * Point d'entrée unique pour devis, commandes, factures, avoirs et tickets POS : les
 * prix, taux et pays d'origine sont **résolus côté serveur** à partir du catalogue,
 * jamais repris tels quels du client. Un poste hors-ligne peut donc proposer un prix,
 * le serveur reste juge — c'est exactement l'asymétrie décrite dans `SYNC_STRATEGY.md`
 * §1 (« le client produit des intentions »).
 */

import { and, eq, inArray } from "drizzle-orm";

import { computeDocumentTotals, type PricingLineInput } from "@shared/pricing";
import { products, services, type Company } from "@shared/schema";
import type { Database } from "../../db";
import { BusinessRuleError, ValidationError } from "../errors/app-error";

/** Ligne telle que reçue de l'API ou d'une opération de synchronisation. */
export interface RawDocumentLine {
  productId?: string | null;
  variantId?: string | null;
  serviceId?: string | null;
  description?: string;
  productSku?: string;
  quantity: number | string;
  unit?: string;
  /** Prix proposé ; le prix catalogue s'applique s'il est omis. */
  unitPriceCents?: number | null;
  discountBp?: number;
  /** Taux proposé ; le taux du produit s'applique s'il est omis. */
  vatRateBp?: number | null;
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
  vatRateBp: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  position: number;
  originCountry: string;
}

export interface BuiltDocument {
  lines: BuiltDocumentLine[];
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  vatBreakdown: { vatRateBp: number; baseCents: number; vatCents: number }[];
}

export interface BuildDocumentOptions {
  globalDiscountBp?: number;
}

/**
 * Résout les lignes contre le catalogue puis applique `computeDocumentTotals`.
 * Refuse une ligne dont ni le produit ni la prestation ni la description ne permettent
 * d'identifier ce qui est vendu : une facture illisible n'est pas une facture.
 */
export async function buildDocumentLines(
  tx: Database,
  company: Pick<Company, "id" | "vatEnabled">,
  rawLines: RawDocumentLine[],
  options: BuildDocumentOptions = {}
): Promise<BuiltDocument> {
  if (rawLines.length === 0) {
    throw new ValidationError("Le document doit comporter au moins une ligne.");
  }

  const productIds = [...new Set(rawLines.map((l) => l.productId).filter(Boolean))] as string[];
  const serviceIds = [...new Set(rawLines.map((l) => l.serviceId).filter(Boolean))] as string[];

  // Requêtes **séquentielles** et non `Promise.all` : `tx` est lié à une seule
  // connexion PostgreSQL, sur laquelle deux requêtes concurrentes se marcheraient
  // dessus (avertissement `pg` « client is already executing a query »).
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
        `Ligne ${index + 1} : produit introuvable ou appartenant à une autre société.`
      );
    }
    if (line.serviceId && !service) {
      throw new BusinessRuleError(`Ligne ${index + 1} : prestation introuvable.`);
    }

    const description = (line.description ?? product?.name ?? service?.name ?? "").trim();
    if (!description) {
      throw new ValidationError(`Ligne ${index + 1} : la désignation est obligatoire.`);
    }

    const unitPriceCents =
      line.unitPriceCents ?? product?.salePriceCents ?? service?.priceCents ?? 0;
    const vatRateBp = company.vatEnabled
      ? (line.vatRateBp ?? product?.vatRateBp ?? service?.vatRateBp ?? 0)
      : 0;

    return {
      raw: line,
      product,
      service,
      description,
      unitPriceCents,
      vatRateBp,
    };
  });

  const totals = computeDocumentTotals(
    resolved.map<PricingLineInput>((entry) => ({
      quantity: entry.raw.quantity,
      unitPriceCents: entry.unitPriceCents,
      discountBp: entry.raw.discountBp ?? 0,
      vatRateBp: entry.vatRateBp,
    })),
    { globalDiscountBp: options.globalDiscountBp, vatEnabled: company.vatEnabled }
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
      unit: entry.raw.unit || entry.product?.unit || "unité",
      unitPriceCents: computed.unitPriceCents,
      discountBp: computed.discountBp,
      vatRateBp: computed.vatRateBp,
      totalHtCents: computed.totalHtCents,
      totalVatCents: computed.totalVatCents,
      totalTtcCents: computed.totalTtcCents,
      position: index,
      originCountry: entry.raw.originCountry ?? "",
    };
  });

  return {
    lines,
    totalHtCents: totals.totalHtCents,
    totalVatCents: totals.totalVatCents,
    totalTtcCents: totals.totalTtcCents,
    vatBreakdown: totals.vatBreakdown,
  };
}
