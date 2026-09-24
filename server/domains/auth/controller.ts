/** HTTP boundary of the authentication domain. */

import type { Request, Response } from "express";

import { authOf } from "./guards";
import { authService } from "./service";

export class AuthController {
  constructor(private readonly service = authService) {}

  private userAgent(req: Request): string {
    return String(req.headers["user-agent"] ?? "");
  }

  login = async (req: Request, res: Response): Promise<void> => {
    const session = await this.service.login({
      body: req.body,
      userAgent: this.userAgent(req),
    });
    res.json(session);
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const session = await this.service.refresh({
      body: req.body,
      userAgent: this.userAgent(req),
    });
    res.json(session);
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.logout(req.body));
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.me(auth.userId, auth.companyId));
  };

  switchCompany = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(
      await this.service.switchCompany({
        userId: auth.userId,
        body: req.body,
        userAgent: this.userAgent(req),
      })
    );
  };

  changePassword = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.changePassword({ userId: auth.userId, body: req.body }));
  };
}
