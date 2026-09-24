/** HTTP boundary of quotes and sales orders. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { salesService } from "./service";

export class SalesController {
  constructor(private readonly service = salesService) {}

  listQuotes = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listQuotes(authOf(req).companyId, req.query));
  };

  getQuote = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getQuote(authOf(req).companyId, req.params.id));
  };

  createQuote = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createQuote(auth.companyId, req.body, auth.userId));
  };

  updateQuote = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateQuote(authOf(req).companyId, req.params.id, req.body));
  };

  setQuoteStatus = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.setQuoteStatus(authOf(req).companyId, req.params.id, req.body));
  };

  convertQuote = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res
      .status(201)
      .json(await this.service.convertQuote(auth.companyId, req.params.id, auth.userId));
  };

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

  setOrderStatus = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.setOrderStatus(authOf(req).companyId, req.params.id, req.body));
  };

  invoiceOrder = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res
      .status(201)
      .json(await this.service.invoiceOrder(auth.companyId, req.params.id, auth.userId));
  };
}
