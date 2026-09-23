/** Frontière HTTP des règlements. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { paymentsService } from "./service";

export class PaymentsController {
  constructor(private readonly service = paymentsService) {}

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
}
