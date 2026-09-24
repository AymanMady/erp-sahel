/**
 * Gardes HTTP : authentification et autorisation RBAC.
 *
 * Ces trois gardes sont la **seule** barrière qui compte : le client masque des écrans
 * par confort, le serveur refuse par contrat ([NFR-SEC-2], [BR-12], [FR-PLAT-4]).
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { hasAllPermissions, hasAnyPermission, type PermissionCode } from "@shared/rbac";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/app-error";
import { bearerToken, verifyAccessToken } from "./tokens";

/** Renseigne `req.auth` à partir du jeton ; échoue si le jeton manque ou est invalide. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next(new UnauthorizedError("Authentification requise"));
    return;
  }
  const claims = verifyAccessToken(token);
  req.auth = {
    userId: claims.sub,
    username: claims.username,
    isSuperuser: claims.isSuperuser,
    companyId: claims.companyId,
    permissions: claims.permissions ?? [],
    enabledModules: claims.modules ?? [],
  };
  req.companyId = claims.companyId;
  next();
}

/**
 * Authentification facultative : renseigne `req.auth` si un jeton valide est présent,
 * mais laisse passer sinon (pages publiques, `/api/health`).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next();
    return;
  }
  try {
    requireAuth(req, _res, next);
  } catch {
    next();
  }
}

export interface AuthorizeOptions {
  /** Au moins une de ces permissions suffit. */
  anyPermission?: PermissionCode[];
  /** Toutes ces permissions sont exigées. */
  allPermissions?: PermissionCode[];
}

export function authorize(options: AuthorizeOptions): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(new UnauthorizedError("Authentification requise"));
      return;
    }
    if (auth.isSuperuser) {
      next();
      return;
    }
    if (options.anyPermission && !hasAnyPermission(auth.permissions, options.anyPermission)) {
      next(new ForbiddenError("Vous n'avez pas la permission d'effectuer cette action."));
      return;
    }
    if (options.allPermissions && !hasAllPermissions(auth.permissions, options.allPermissions)) {
      next(new ForbiddenError("Vous n'avez pas la permission d'effectuer cette action."));
      return;
    }
    next();
  };
}

/** Réservé aux super-administrateurs plateforme. */
export function requireSuperuser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new UnauthorizedError("Authentification requise"));
    return;
  }
  if (!req.auth.isSuperuser) {
    next(new ForbiddenError("Action réservée à l'administration de la plateforme."));
    return;
  }
  next();
}

/** Raccourci typé pour les contrôleurs : `req.auth` est garanti après `requireAuth`. */
export function authOf(req: Request) {
  if (!req.auth) throw new UnauthorizedError("Authentification requise");
  return req.auth;
}
