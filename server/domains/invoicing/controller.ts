/** HTTP boundary of invoicing. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { invoicingService } from "./service";

export class InvoicingController {
  constructor(private readonly service = invoicingService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.list(authOf(req).companyId, req.query));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.get(authOf(req).companyId, req.params.id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.create(auth.companyId, req.body, auth.userId));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.update(authOf(req).companyId, req.params.id, req.body));
  };

  validate = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.validate(auth.companyId, req.params.id, auth.userId));
  };

  cancelDraft = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.cancelDraft(authOf(req).companyId, req.params.id));
  };

  listCreditNotes = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listCreditNotes(authOf(req).companyId, req.query));
  };

  getCreditNote = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getCreditNote(authOf(req).companyId, req.params.id));
  };

  createCreditNote = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res
      .status(201)
      .json(await this.service.createCreditNote(auth.companyId, req.body, auth.userId));
  };
}
