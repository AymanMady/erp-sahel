/** Frontière HTTP de la synchronisation. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { syncService } from "./service";

/** Identifiant de poste : en-tête dédié, avec repli lisible pour le diagnostic. */
function deviceId(req: Request): string {
  return String(req.headers["x-device-id"] ?? "").slice(0, 128) || "inconnu";
}

export class SyncController {
  constructor(private readonly service = syncService) {}

  snapshot = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(
      await this.service.snapshot({
        companyId: auth.companyId,
        userId: auth.userId,
        deviceId: deviceId(req),
        platform: req.query.platform ?? req.headers["x-device-platform"],
      })
    );
  };

  pull = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.pull(authOf(req).companyId, req.query));
  };

  push = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(
      await this.service.push({
        companyId: auth.companyId,
        userId: auth.userId,
        body: req.body,
      })
    );
  };

  status = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.status(authOf(req).companyId));
  };

  journal = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.journal(authOf(req).companyId));
  };
}
