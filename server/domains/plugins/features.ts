/**
 * Garde API des modules (caisse, achats, stock…).
 *
 * Désactiver un module ne supprime rien : ses routes API répondent 403 et ses écrans
 * sortent du menu. Les services internes continuent de s'appeler entre eux — une vente
 * en caisse crée toujours sa facture, même si l'écran « Factures » est masqué.
 */

import type { RequestHandler } from "express";

import { FEATURE_MODULES } from "@shared/modules-catalog";
import { ModuleDisabledError } from "../../shared/errors/app-error";
import { bearerToken, verifyAccessToken } from "../auth/tokens";

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Refuse les appels vers une fonctionnalité désactivée pour la société.
 *
 * Monté une seule fois devant les routes du noyau. Sans jeton valide, il laisse
 * passer : `requireAuth` de la route répondra 401, ce qui reste le bon message.
 * La synchronisation hors ligne n'est volontairement pas filtrée : une vente saisie
 * sans réseau ne doit jamais être perdue parce qu'un module a été masqué entre-temps.
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
