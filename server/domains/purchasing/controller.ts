/** HTTP boundary of purchasing. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { purchasingService } from "./service";

export class PurchasingController {
  constructor(private readonly service = purchasingService) {}

  listOrders = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listOrders(authOf(req).companyId, req.query));
  };

  getOrder = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getOrder(authOf(req).companyId, req.params.id));
  };

  createOrder = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createOrder(auth.companyId, req.body, auth.userId));
  };

  updateOrder = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateOrder(authOf(req).companyId, req.params.id, req.body));
  };

  setOrderStatus = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.setOrderStatus(authOf(req).companyId, req.params.id, req.body));
  };

  listReceipts = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listReceipts(authOf(req).companyId, req.query));
  };

  getReceipt = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getReceipt(authOf(req).companyId, req.params.id));
  };

  createReceipt = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createReceipt(auth.companyId, req.body, auth.userId));
  };

  listSupplierInvoices = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listSupplierInvoices(authOf(req).companyId, req.query));
  };

  createSupplierInvoice = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createSupplierInvoice(authOf(req).companyId, req.body));
  };
}
