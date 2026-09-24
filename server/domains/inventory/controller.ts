/** HTTP boundary of inventory. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { inventoryService } from "./service";

export class InventoryController {
  constructor(private readonly service = inventoryService) {}

  listStock = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listStock(authOf(req).companyId, req.query));
  };

  listMovements = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listMovements(authOf(req).companyId, req.query));
  };

  createMovement = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createMovement(auth.companyId, req.body, auth.userId));
  };

  transfer = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.transfer(auth.companyId, req.body, auth.userId));
  };

  valuation = async (req: Request, res: Response): Promise<void> => {
    res.json(
      await this.service.valuation(
        authOf(req).companyId,
        typeof req.query.warehouseId === "string" ? req.query.warehouseId : null
      )
    );
  };

  lowStock = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.lowStock(authOf(req).companyId));
  };

  listWarehouses = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listWarehouses(authOf(req).companyId));
  };

  createWarehouse = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createWarehouse(authOf(req).companyId, req.body));
  };

  updateWarehouse = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateWarehouse(authOf(req).companyId, req.params.id, req.body));
  };

  archiveWarehouse = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archiveWarehouse(authOf(req).companyId, req.params.id));
  };
}
