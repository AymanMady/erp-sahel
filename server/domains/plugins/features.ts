/**
 * API guard of the modules (POS, purchasing, stock…).
 *
 * Disabling a module deletes nothing: its API routes answer 403 and its screens leave
 * the menu. Internal services keep calling each other — a POS sale still creates its
 * invoice, even when the "Invoices" screen is hidden.
 */

import type { RequestHandler } from "express";

import { FEATURE_MODULES } from "@shared/modules-catalog";
import { ModuleDisabledError } from "../../shared/errors/app-error";
import { bearerToken, verifyAccessToken } from "../auth/tokens";

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Rejects calls to a feature that is disabled for the company.
 *
 * Mounted once in front of the core routes. Without a valid token it lets the request
 * through: the route's `requireAuth` will answer 401, which is still the right message.
 * Offline sync is deliberately not filtered: a sale entered without network must never
 * be lost because a module was hidden in the meantime.
 */
export const featureGate: RequestHandler = (req, _res, next) => {
  const path = req.originalUrl.split("?")[0] ?? "";
  const feature = FEATURE_MODULES.find((candidate) =>
    candidate.apiPrefixes.some((prefix) => matchesPrefix(path, prefix))
  );
  if (!feature) {
    next();
    return;
  }
  if (req.method === "GET" && feature.openReads?.some((prefix) => matchesPrefix(path, prefix))) {
    next();
    return;
  }

  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next();
    return;
  }
  let modules: string[];
  try {
    const claims = verifyAccessToken(token);
    if (!claims.featureGating) {
      next();
      return;
    }
    modules = claims.modules ?? [];
  } catch {
    next();
    return;
  }
  next(modules.includes(feature.code) ? undefined : new ModuleDisabledError(feature.name));
};
