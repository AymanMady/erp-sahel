/** Frontière HTTP du point de vente. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { posService } from "./service";

export class PosController {
  constructor(private readonly service = posService) {}

  listRegisters = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listRegisters(authOf(req).companyId));
  };

  createRegister = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createRegister(authOf(req).companyId, req.body));
  };

  updateRegister = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.updateRegister(authOf(req).companyId, req.params.id, req.body));
  };

  archiveRegister = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archiveRegister(authOf(req).companyId, req.params.id));
  };

  listSessions = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listSessions(authOf(req).companyId, req.query));
  };

  currentSession = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.currentSession(auth.companyId, auth.userId));
  };

  sessionSummary = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.sessionSummary(authOf(req).companyId, req.params.id));
  };

  openSession = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.openSession(auth.companyId, auth.userId, req.body));
  };

  closeSession = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.closeSession(authOf(req).companyId, req.params.id, req.body));
  };

  createTicket = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createTicket(auth.companyId, auth.userId, req.body));
  };
}
