/**
 * HTTP guards: authentication and RBAC authorization.
 *
 * These three guards are the **only** barrier that matters: the client hides screens
 * for convenience, the server refuses by contract ([NFR-SEC-2], [BR-12], [FR-PLAT-4]).
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  ALL_PERMISSION_CODES,
  hasAllPermissions,
  hasAnyPermission,
  type PermissionCode,
} from "@shared/rbac";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/app-error";
import { authRepository } from "./repository";
import { bearerToken, verifyAccessToken } from "./tokens";

/**
 * The token alone is not enough: an account disabled, removed from the company, whose
 * roles changed or whose password was reset must lose its rights right away, not when
 * the token expires. The state is read from the database and kept a few seconds per
 * instance so that a busy register does not query it on every call.
 */
const SESSION_STATE_TTL_MS = 10_000;

type SessionState = NonNullable<Awaited<ReturnType<typeof authRepository.loadSessionState>>>;

const sessionStates = new Map<string, { state: SessionState | null; loadedAt: number }>();

async function sessionState(userId: string, companyId: string): Promise<SessionState | null> {
  const key = `${userId}:${companyId}`;
  const cached = sessionStates.get(key);
  if (cached && Date.now() - cached.loadedAt < SESSION_STATE_TTL_MS) return cached.state;
  const state = await authRepository.loadSessionState(userId, companyId);
  if (sessionStates.size > 5_000) sessionStates.clear();
  sessionStates.set(key, { state, loadedAt: Date.now() });
  return state;
}

/** Forgets the cached state of a user after an administrator changed their account. */
export function invalidateSessionState(userId: string): void {
  for (const key of sessionStates.keys()) {
    if (key.startsWith(`${userId}:`)) sessionStates.delete(key);
  }
}

/** Forgets every cached state (a role's permissions changed). */
export function invalidateAllSessionStates(): void {
  sessionStates.clear();
}

async function resolveAuth(token: string): Promise<NonNullable<Request["auth"]>> {
  const claims = verifyAccessToken(token);
  const state = await sessionState(claims.sub, claims.companyId);
  if (!state || !state.isActive || !state.isMember) {
    throw new UnauthorizedError("Account not found or disabled.");
  }
  const issuedAt = (claims as { iat?: number }).iat ?? 0;
  if (
    state.sessionsValidAfter &&
    issuedAt < Math.floor(state.sessionsValidAfter.getTime() / 1000)
  ) {
    throw new UnauthorizedError("Session expired, please sign in again.");
  }
  return {
    userId: claims.sub,
    username: claims.username,
    isSuperuser: state.isSuperuser,
    companyId: claims.companyId,
    permissions: state.isSuperuser
      ? [...ALL_PERMISSION_CODES]
      : (state.permissions as PermissionCode[]),
    enabledModules: claims.modules ?? [],
  };
}

/** Populates `req.auth` from the token; fails if the token is missing or invalid. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }
  resolveAuth(token).then(
    (auth) => {
      req.auth = auth;
      req.companyId = auth.companyId;
      next();
    },
    (error: unknown) => next(error)
  );
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
  resolveAuth(token).then(
    (auth) => {
      req.auth = auth;
      req.companyId = auth.companyId;
      next();
    },
    () => next()
  );
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

/**
 * May this person sell a catalog item at another price than the catalog one? Whoever
 * may change the catalog prices may also change them on a sale.
 */
export function canSetPrices(auth: { isSuperuser: boolean; permissions: readonly string[] }) {
  return auth.isSuperuser || auth.permissions.includes("catalog.write");
}
