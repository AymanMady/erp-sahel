/** HTTP boundary of accounting. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { accountingService } from "./service";

export class AccountingController {
  constructor(private readonly service = accountingService) {}

  listAccounts = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listAccounts(authOf(req).companyId));
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

  listJournals = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listJournals(authOf(req).companyId));
  };

  createJournal = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createJournal(authOf(req).companyId, req.body));
  };

  updateJournal = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateJournal(authOf(req).companyId, req.params.id, req.body));
  };

  listMappings = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listMappings(authOf(req).companyId));
  };

  setMapping = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.setMapping(authOf(req).companyId, req.body));
  };

  listEntries = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listEntries(authOf(req).companyId, req.query));
  };

  createManualEntry = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createManualEntry(authOf(req).companyId, req.body));
  };

  ledger = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.ledger(authOf(req).companyId, req.query));
  };

  balance = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.balance(authOf(req).companyId, req.query));
  };

  listFiscalYears = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listFiscalYears(authOf(req).companyId));
  };

  createFiscalYear = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createFiscalYear(authOf(req).companyId, req.body));
  };

  closeFiscalYear = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.closeFiscalYear(authOf(req).companyId, req.params.id));
  };
}
