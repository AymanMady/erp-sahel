/** HTTP boundary of treasury. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { bankingService } from "./service";

export class BankingController {
  constructor(private readonly service = bankingService) {}

  listAccounts = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listAccounts(authOf(req).companyId));
  };

  getAccount = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getAccount(authOf(req).companyId, req.params.id));
  };

  createAccount = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createAccount(authOf(req).companyId, req.body));
  };

  updateAccount = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateAccount(authOf(req).companyId, req.params.id, req.body));
  };

  archiveAccount = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archiveAccount(authOf(req).companyId, req.params.id));
  };

  listTransactions = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listTransactions(authOf(req).companyId, req.query));
  };

  createTransaction = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createTransaction(authOf(req).companyId, req.body));
  };

  transfer = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.transfer(authOf(req).companyId, req.body));
  };

  setReconciled = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.setReconciled(authOf(req).companyId, req.params.id, req.body));
  };

  totals = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.totals(authOf(req).companyId));
  };
}
