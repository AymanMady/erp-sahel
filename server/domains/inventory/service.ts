/** Application boundary of inventory. */

import { asc } from "drizzle-orm";

import { warehouses } from "@shared/schema";
import { NotFoundError } from "../../shared/errors/app-error";
import { inventoryApplication } from "./application";
import { inventoryRepository, warehousesRepository } from "./repository";
import {
  createMovementSchema,
  createWarehouseSchema,
  idParamSchema,
  listMovementsQuerySchema,
  listStockQuerySchema,
  transferSchema,
  updateWarehouseSchema,
} from "./schemas";

export class InventoryService {
  async listStock(companyId: string, query: unknown) {
    return inventoryRepository.listStock(companyId, listStockQuerySchema.parse(query ?? {}));
  }

  async listMovements(companyId: string, query: unknown) {
    return inventoryRepository.listMovements(
      companyId,
      listMovementsQuerySchema.parse(query ?? {})
    );
  }

  async createMovement(companyId: string, body: unknown, userId: string) {
    const data = createMovementSchema.parse(body);
    return inventoryApplication.applyStandaloneMovement({
      companyId,
      ...data,
      originType: "manual",
      userId,
    });
  }

  async transfer(companyId: string, body: unknown, userId: string) {
    return inventoryApplication.transfer({
      companyId,
      ...transferSchema.parse(body),
      userId,
    });
  }

  async valuation(companyId: string, warehouseId?: string | null) {
    return inventoryApplication.valuation(companyId, warehouseId ?? null);
  }

  async lowStock(companyId: string) {
    return inventoryApplication.lowStock(companyId, 50);
  }

  async listWarehouses(companyId: string) {
    return warehousesRepository.listAll(companyId, { orderBy: [asc(warehouses.name)] });
  }

  async createWarehouse(companyId: string, body: unknown) {
    return warehousesRepository.create(companyId, createWarehouseSchema.parse(body));
  }

  async updateWarehouse(companyId: string, id: unknown, body: unknown) {
    const { id: warehouseId } = idParamSchema.parse({ id });
    const warehouse = await warehousesRepository.update(
      companyId,
      warehouseId,
      updateWarehouseSchema.parse(body)
    );
    if (!warehouse) throw new NotFoundError("Warehouse not found.");
    return warehouse;
  }

  async archiveWarehouse(companyId: string, id: unknown) {
    const { id: warehouseId } = idParamSchema.parse({ id });
    const archived = await warehousesRepository.archive(companyId, warehouseId);
    if (!archived) throw new NotFoundError("Warehouse not found.");
    return { success: true as const };
  }
}

export const inventoryService = new InventoryService();
