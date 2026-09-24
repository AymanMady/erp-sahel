/**
 * HTTP guards: authentication and RBAC authorization.
 *
 * These three guards are the **only** barrier that matters: the client hides screens
 * for convenience, the server refuses by contract ([NFR-SEC-2], [BR-12], [FR-PLAT-4]).
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { hasAllPermissions, hasAnyPermission, type PermissionCode } from "@shared/rbac";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/app-error";
import { bearerToken, verifyAccessToken } from "./tokens";

/** Populates `req.auth` from the token; fails if the token is missing or invalid. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next(new UnauthorizedError("Authentication required"));
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
 * Optional authentication: populates `req.auth` when a valid token is present,
 * but lets the request through otherwise (public pages, `/api/health`).
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
  /** Any one of these permissions is enough. */
  anyPermission?: PermissionCode[];
  /** All of these permissions are required. */
  allPermissions?: PermissionCode[];
}

export function authorize(options: AuthorizeOptions): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(new UnauthorizedError("Authentication required"));
      return;
    }
    if (auth.isSuperuser) {
      next();
      return;
    }
    if (options.anyPermission && !hasAnyPermission(auth.permissions, options.anyPermission)) {
      next(new ForbiddenError("You do not have permission to perform this action."));
      return;
    }
    if (options.allPermissions && !hasAllPermissions(auth.permissions, options.allPermissions)) {
      next(new ForbiddenError("You do not have permission to perform this action."));
      return;
    }
    next();
  };
}

/** Restricted to platform super-administrators. */
export function requireSuperuser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }
  if (!req.auth.isSuperuser) {
    next(new ForbiddenError("This action is restricted to platform administrators."));
    return;
  }
  next();
}

/** Typed shortcut for controllers: `req.auth` is guaranteed after `requireAuth`. */
export function authOf(req: Request) {
  if (!req.auth) throw new UnauthorizedError("Authentication required");
  return req.auth;
}
