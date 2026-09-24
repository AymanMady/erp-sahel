/**
 * Stock orchestration — the **single entry point** for any stock effect.
 *
 * Sales, purchases, POS, credit notes and stock counts must all go through
 * `applyMovement`: this is what makes the balance auditable (sum of movements) and
 * prevents a domain from "fixing" a stock level without leaving a trace ([FR-STK-3],
 * [FR-STK-4], [BR-6]).
 */

import { normalizeQuantity, roundHalfUp } from "@shared/money";
import {
  defaultDirection,
  type MovementDirection,
  type MovementOrigin,
  type MovementType,
  type StockMovement,
} from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { inventoryRepository, warehousesRepository } from "./repository";

export interface MovementInput {
  companyId: string;
  productId: string;
  warehouseId: string;
  variantId?: string | null;
  locationId?: string | null;
  lotNumber?: string;
  movementType: MovementType;
  /** Explicit direction; inferred from the type when omitted. */
  direction?: MovementDirection;
  /** Always positive. */
  quantity: number | string;
  unitCostCents?: number;
  originType?: MovementOrigin;
  originId?: string | null;
  reference?: string;
  reason?: string;
  userId?: string | null;
  clientUuid?: string | null;
  /**
   * Allows a negative balance. Refused by default: a sale must not take stock below
   * zero without an explicit decision ([FR-STK-4]).
   */
  allowNegative?: boolean;
}

class InventoryApplication {
  /** Default warehouse of the company — used when the caller does not specify one. */
  async defaultWarehouseId(companyId: string, database: Database = db): Promise<string> {
    const repository = warehousesRepository.withTransaction(database);
    const all = await repository.listAll(companyId);
    const preferred = all.find((warehouse) => warehouse.isDefault) ?? all[0];
    if (!preferred) {
      throw new BusinessRuleError(
        "No warehouse is configured. Create one in Settings › Warehouses.",
        "NO_WAREHOUSE"
      );
    }
    return preferred.id;
  }

  /**
   * Applies a movement and updates the balance in the **same transaction**.
   * Returns the inserted movement, including the resulting balance.
   */
  async applyMovement(tx: Database, input: MovementInput): Promise<StockMovement> {
    const quantity = normalizeQuantity(input.quantity);
    if (quantity <= 0) {
      throw new BusinessRuleError("A movement quantity must be strictly positive.");
    }
    const direction = input.direction ?? defaultDirection(input.movementType);
    const repository = inventoryRepository.withTransaction(tx);

    const stockItem = await repository.ensureStockItem({
      companyId: input.companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      locationId: input.locationId,
      lotNumber: input.lotNumber ?? "",
    });

    const currentQuantity = normalizeQuantity(stockItem.quantity);
    const delta = direction === "IN" ? quantity : -quantity;
    const nextQuantity = normalizeQuantity(currentQuantity + delta);

    if (nextQuantity < 0 && !input.allowNegative) {
      throw new BusinessRuleError(
        tr("Insufficient stock: {available} available, {requested} requested.", {
          available: currentQuantity,
          requested: quantity,
        }),
        "INSUFFICIENT_STOCK",
        { available: currentQuantity, requested: quantity }
      );
    }

    // Weighted average cost: only valued incoming movements change it.
    let averageCostCents: number | null = null;
    if (direction === "IN" && (input.unitCostCents ?? 0) > 0) {
      const previousValue = currentQuantity * stockItem.averageCostCents;
      const incomingValue = quantity * (input.unitCostCents ?? 0);
      averageCostCents =
        nextQuantity > 0
          ? roundHalfUp((previousValue + incomingValue) / nextQuantity)
          : (input.unitCostCents ?? 0);
    }

    await repository.applyDelta({
      companyId: input.companyId,
      stockItemId: stockItem.id,
      deltaQuantity: delta.toFixed(3),
      averageCostCents,
    });

    return repository.insertMovement({
      companyId: input.companyId,
      stockItemId: stockItem.id,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: input.movementType,
      direction,
      quantity: quantity.toFixed(3),
      balanceAfter: nextQuantity.toFixed(3),
      unitCostCents: input.unitCostCents ?? stockItem.averageCostCents,
      originType: input.originType ?? "manual",
      originId: input.originId ?? null,
      reference: input.reference ?? "",
      reason: input.reason ?? "",
      userId: input.userId ?? null,
      clientUuid: input.clientUuid ?? null,
    });
  }

  /** Standalone movement (manual adjustment): opens its own transaction. */
  async applyStandaloneMovement(input: MovementInput): Promise<StockMovement> {
    return runInTransaction((tx) => this.applyMovement(tx, input));
  }

  /**
   * Transfer between warehouses: one outgoing and one incoming movement linked by the
   * same reference, in a single transaction — there is never a state where goods have
   * left one warehouse without arriving in the other.
   */
  async transfer(input: {
    companyId: string;
    productId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number | string;
    lotNumber?: string;
    reason?: string;
    userId?: string | null;
  }): Promise<{ out: StockMovement; in: StockMovement }> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BusinessRuleError("Source and destination warehouses must differ.");
    }
    const reason = input.reason ?? tr("Inter-warehouse transfer");
    return runInTransaction(async (tx) => {
      const reference = `TRF-${Date.now().toString(36).toUpperCase()}`;
      const out = await this.applyMovement(tx, {
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.fromWarehouseId,
        lotNumber: input.lotNumber,
        movementType: "TRANSFER",
        direction: "OUT",
        quantity: input.quantity,
        originType: "transfer",
        reference,
        reason,
        userId: input.userId,
      });
      const incoming = await this.applyMovement(tx, {
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.toWarehouseId,
        lotNumber: input.lotNumber,
        movementType: "TRANSFER",
        direction: "IN",
        quantity: input.quantity,
        unitCostCents: out.unitCostCents,
        originType: "transfer",
        originId: out.id,
        reference,
        reason,
        userId: input.userId,
      });
      return { out, in: incoming };
    });
  }

  /**
   * Decrements stock for the lines of a sales document ([FR-VNT-3]).
   * Service lines and lines without a product are silently skipped: a service has no
   * stock.
   */
  async consumeForDocument(
    tx: Database,
    input: {
      companyId: string;
      warehouseId: string;
      originType: MovementOrigin;
      originId: string;
      reference: string;
      userId?: string | null;
      allowNegative?: boolean;
      lines: { productId?: string | null; quantity: number | string; lotNumber?: string }[];
    }
  ): Promise<StockMovement[]> {
    const movements: StockMovement[] = [];
    for (const line of input.lines) {
      if (!line.productId) continue;
      movements.push(
        await this.applyMovement(tx, {
          companyId: input.companyId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          lotNumber: line.lotNumber,
          movementType: "OUT",
          quantity: line.quantity,
          originType: input.originType,
          originId: input.originId,
          reference: input.reference,
          userId: input.userId,
          allowNegative: input.allowNegative,
        })
      );
    }
    return movements;
  }

  /** Puts stock back (credit note, return) — mirror of `consumeForDocument` [FR-VNT-6]. */
  async restockForDocument(
    tx: Database,
    input: {
      companyId: string;
      warehouseId: string;
      originType: MovementOrigin;
      originId: string;
      reference: string;
      userId?: string | null;
      lines: { productId?: string | null; quantity: number | string; lotNumber?: string }[];
    }
  ): Promise<StockMovement[]> {
    const movements: StockMovement[] = [];
    for (const line of input.lines) {
      if (!line.productId) continue;
      movements.push(
        await this.applyMovement(tx, {
          companyId: input.companyId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          lotNumber: line.lotNumber,
          movementType: "RETURN",
          quantity: line.quantity,
          originType: input.originType,
          originId: input.originId,
          reference: input.reference,
          userId: input.userId,
        })
      );
    }
    return movements;
  }

  /** Stock receipt for a goods receipt note ([FR-ACH-3]). */
  async receiveForDocument(
    tx: Database,
    input: {
      companyId: string;
      warehouseId: string;
      originId: string;
      reference: string;
      userId?: string | null;
      lines: {
        productId: string;
        quantity: number | string;
        unitCostCents: number;
        lotNumber?: string;
      }[];
    }
  ): Promise<StockMovement[]> {
    const movements: StockMovement[] = [];
    for (const line of input.lines) {
      movements.push(
        await this.applyMovement(tx, {
          companyId: input.companyId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          lotNumber: line.lotNumber,
          movementType: "IN",
          quantity: line.quantity,
          unitCostCents: line.unitCostCents,
          originType: "purchase_receipt",
          originId: input.originId,
          reference: input.reference,
          userId: input.userId,
        })
      );
    }
    return movements;
  }

  /**
   * Balances per product — exposed to other domains (catalog, POS, reports).
   * Going through the application layer rather than the repository upholds the rule
   * "no domain reads another domain's repository directly".
   */
  async quantitiesByProduct(companyId: string, productIds: string[]): Promise<Map<string, number>> {
    return inventoryRepository.quantitiesByProduct(companyId, productIds);
  }

  async availableQuantity(
    companyId: string,
    productId: string,
    warehouseId?: string | null
  ): Promise<number> {
    return inventoryRepository.availableQuantity(companyId, productId, warehouseId);
  }

  async valuation(companyId: string, warehouseId?: string | null) {
    return inventoryRepository.valuation(companyId, warehouseId);
  }

  async lowStock(companyId: string, limit = 20) {
    return inventoryRepository.lowStock(companyId, limit);
  }

  async requireWarehouse(companyId: string, warehouseId: string): Promise<void> {
    const warehouse = await warehousesRepository.findById(companyId, warehouseId);
    if (!warehouse) throw new NotFoundError("Warehouse not found.");
  }
}

export const inventoryApplication = new InventoryApplication();
