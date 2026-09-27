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

    await this.requireOwnership(tx, input);

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
      throw insufficientStock(currentQuantity, quantity);
    }

    // Weighted average cost: only valued incoming movements change it. With no stock
    // (or a negative balance), the old average means nothing: the incoming cost wins.
    const incomingCostCents = input.unitCostCents ?? 0;
    let averageCostCents: number | null = null;
    if (direction === "IN" && incomingCostCents > 0) {
      averageCostCents =
        currentQuantity > 0
          ? roundHalfUp(
              (currentQuantity * stockItem.averageCostCents + quantity * incomingCostCents) /
                nextQuantity
            )
          : incomingCostCents;
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
      // A movement without a known cost is recorded at the current average cost.
      unitCostCents: incomingCostCents > 0 ? incomingCostCents : stockItem.averageCostCents,
      originType: input.originType ?? "manual",
      originId: input.originId ?? null,
      reference: input.reference ?? "",
      reason: input.reason ?? "",
      userId: input.userId ?? null,
      clientUuid: input.clientUuid ?? null,
    });
  }

  /**
   * The product, the store (and the model or place, when given) must belong to the
   * company: identifiers come from the request and must never reach another company.
   */
  private async requireOwnership(tx: Database, input: MovementInput): Promise<void> {
    const owned = await inventoryRepository.withTransaction(tx).checkOwnership(input);
    if (!owned.product) throw new NotFoundError("Product not found.");
    if (!owned.warehouse) throw new NotFoundError("Warehouse not found.");
    if (!owned.variant) {
      throw new BusinessRuleError("This model does not belong to the chosen product.");
    }
    if (!owned.location) {
      throw new BusinessRuleError("This place does not belong to the chosen store.");
    }
  }

  /**
   * Splits a quantity to take out over the lots of a product in a store, oldest first
   * (FIFO). A sale does not name a lot: without this, stock received with a lot number
   * would be shown as available but refused at the till.
   * The remainder, when negative stock is allowed, goes on the line without a lot.
   */
  private async allocateOut(
    tx: Database,
    input: {
      companyId: string;
      productId: string;
      warehouseId: string;
      quantity: number;
      allowNegative?: boolean;
    }
  ): Promise<{ lotNumber: string; quantity: number }[]> {
    const items = await inventoryRepository
      .withTransaction(tx)
      .lockProductStock(input.companyId, input.productId, input.warehouseId);

    const allocations: { lotNumber: string; quantity: number }[] = [];
    let remaining = input.quantity;
    let available = 0;
    for (const item of items) {
      const onHand = normalizeQuantity(item.quantity);
      if (onHand <= 0) continue;
      available = normalizeQuantity(available + onHand);
      if (remaining <= 0) continue;
      const taken = Math.min(onHand, remaining);
      allocations.push({ lotNumber: item.lotNumber, quantity: taken });
      remaining = normalizeQuantity(remaining - taken);
    }

    if (remaining > 0) {
      if (!input.allowNegative) throw insufficientStock(available, input.quantity);
      const untracked = allocations.find((allocation) => allocation.lotNumber === "");
      if (untracked) untracked.quantity = normalizeQuantity(untracked.quantity + remaining);
      else allocations.push({ lotNumber: "", quantity: remaining });
    }
    return allocations;
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
      const quantity = normalizeQuantity(line.quantity);
      // A named lot is taken as is; otherwise the lots are used oldest first.
      const allocations = line.lotNumber
        ? [{ lotNumber: line.lotNumber, quantity }]
        : await this.allocateOut(tx, {
            companyId: input.companyId,
            productId: line.productId,
            warehouseId: input.warehouseId,
            quantity,
            allowNegative: input.allowNegative,
          });
      for (const allocation of allocations) {
        movements.push(
          await this.applyMovement(tx, {
            companyId: input.companyId,
            productId: line.productId,
            warehouseId: input.warehouseId,
            lotNumber: allocation.lotNumber,
            movementType: "OUT",
            quantity: allocation.quantity,
            originType: input.originType,
            originId: input.originId,
            reference: input.reference,
            userId: input.userId,
            allowNegative: input.allowNegative,
          })
        );
      }
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
    const repository = inventoryRepository.withTransaction(tx);
    const movements: StockMovement[] = [];
    for (const line of input.lines) {
      if (!line.productId) continue;
      // Goods returned without a lot go back on the line without a lot, valued at the
      // average cost of the product in this store so they do not lower its value.
      const unitCostCents = line.lotNumber
        ? undefined
        : await repository.averageCostInWarehouse(
            input.companyId,
            line.productId,
            input.warehouseId
          );
      movements.push(
        await this.applyMovement(tx, {
          companyId: input.companyId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          lotNumber: line.lotNumber,
          movementType: "RETURN",
          quantity: line.quantity,
          unitCostCents,
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
        variantId?: string | null;
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
          variantId: line.variantId,
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

function insufficientStock(available: number, requested: number): BusinessRuleError {
  return new BusinessRuleError(
    tr("Insufficient stock: {available} available, {requested} requested.", {
      available,
      requested,
    }),
    "INSUFFICIENT_STOCK",
    { available, requested }
  );
}

export const inventoryApplication = new InventoryApplication();
