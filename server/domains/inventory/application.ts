/**
 * Orchestration du stock — **point d'entrée unique** pour tout effet de stock.
 *
 * Ventes, achats, POS, avoirs et inventaires passent obligatoirement par
 * `applyMovement` : c'est ce qui rend le solde auditable (somme des mouvements) et
 * empêche qu'un domaine « corrige » un stock sans laisser de trace ([FR-STK-3],
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
import { inventoryRepository, warehousesRepository } from "./repository";

export interface MovementInput {
  companyId: string;
  productId: string;
  warehouseId: string;
  variantId?: string | null;
  locationId?: string | null;
  lotNumber?: string;
  movementType: MovementType;
  /** Sens explicite ; déduit du type quand il est omis. */
  direction?: MovementDirection;
  /** Toujours positive. */
  quantity: number | string;
  unitCostCents?: number;
  originType?: MovementOrigin;
  originId?: string | null;
  reference?: string;
  reason?: string;
  userId?: string | null;
  clientUuid?: string | null;
  /**
   * Autorise un solde négatif. Refusé par défaut : une vente ne doit pas faire
   * passer le stock sous zéro sans décision explicite ([FR-STK-4]).
   */
  allowNegative?: boolean;
}

class InventoryApplication {
  /** Magasin par défaut de la société — utilisé quand l'appelant n'en précise pas. */
  async defaultWarehouseId(companyId: string, database: Database = db): Promise<string> {
    const repository = warehousesRepository.withTransaction(database);
    const all = await repository.listAll(companyId);
    const preferred = all.find((warehouse) => warehouse.isDefault) ?? all[0];
    if (!preferred) {
      throw new BusinessRuleError(
        "Aucun magasin n'est configuré. Créez-en un dans Paramètres › Magasins.",
        "NO_WAREHOUSE"
      );
    }
    return preferred.id;
  }

  /**
   * Applique un mouvement et met à jour le solde dans la **même transaction**.
   * Renvoie le mouvement inséré, solde après application inclus.
   */
  async applyMovement(tx: Database, input: MovementInput): Promise<StockMovement> {
    const quantity = normalizeQuantity(input.quantity);
    if (quantity <= 0) {
      throw new BusinessRuleError("La quantité d'un mouvement doit être strictement positive.");
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
        `Stock insuffisant : ${currentQuantity} disponible, ${quantity} demandé.`,
        "INSUFFICIENT_STOCK",
        { available: currentQuantity, requested: quantity }
      );
    }

    // Coût moyen pondéré : seules les entrées valorisées le déplacent.
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

  /** Mouvement isolé (ajustement manuel) : ouvre sa propre transaction. */
  async applyStandaloneMovement(input: MovementInput): Promise<StockMovement> {
    return runInTransaction((tx) => this.applyMovement(tx, input));
  }

  /**
   * Transfert entre magasins : une sortie et une entrée liées par la même référence,
   * dans une seule transaction — il n'existe jamais d'état où la marchandise a quitté
   * un magasin sans être arrivée dans l'autre.
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
      throw new BusinessRuleError("Les magasins source et destination doivent différer.");
    }
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
        reason: input.reason ?? "Transfert inter-magasins",
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
        reason: input.reason ?? "Transfert inter-magasins",
        userId: input.userId,
      });
      return { out, in: incoming };
    });
  }

  /**
   * Décrémente le stock pour les lignes d'un document de vente ([FR-VNT-3]).
   * Les lignes de service et les lignes sans produit sont ignorées silencieusement :
   * une prestation n'a pas de stock.
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

  /** Réintègre le stock (avoir, retour) — écriture miroir de `consumeForDocument` [FR-VNT-6]. */
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

  /** Entrée en stock d'un bon de réception ([FR-ACH-3]). */
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
   * Soldes par produit — exposé aux autres domaines (catalogue, POS, rapports).
   * Passer par l'application plutôt que par le repository maintient la règle
   * « aucun domaine ne lit directement le repository d'un autre ».
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
    if (!warehouse) throw new NotFoundError("Magasin introuvable.");
  }
}

export const inventoryApplication = new InventoryApplication();
