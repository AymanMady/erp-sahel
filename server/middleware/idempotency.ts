/**
 * Idempotence des écritures HTTP rejouées depuis la file hors ligne du poste.
 *
 * Quand le réseau tombe pendant une écriture, le client ne sait pas si le serveur l'a
 * traitée ; il la met en file et la rejoue plus tard avec la **même** clé
 * `Idempotency-Key`. La première réponse réussie est journalisée dans
 * `sync_operations` (entité `http.request`) : un rejeu reçoit cette réponse telle
 * quelle, sans réécrire ([BR-8]). Seules les réponses JSON réussies sont journalisées : un
 * échec doit pouvoir être retenté, et une réponse vide (suppression) se rejoue sans
 * dommage — le client tient un 404 rejoué comme un succès.
 */

import type { NextFunction, Request, Response } from "express";

import { bearerToken, verifyAccessToken } from "../domains/auth/tokens";
import { syncRepository } from "../domains/sync/repository";
import { logger } from "../shared/logging/logger";

export const HTTP_REQUEST_ENTITY = "http.request";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

interface StoredResponse {
  method: string;
  path: string;
  statusCode: number;
  body: unknown;
}

/** Chemin complet (sans requête), indépendant du point de montage du middleware. */
function requestPath(req: Request): string {
  return req.originalUrl.split("?")[0];
}

/** Société du jeton, sans lever : la route reste seule juge de l'authentification. */
function companyOf(req: Request): { companyId: string; userId: string } | null {
  const token = bearerToken(req.headers.authorization);
  if (!token) return null;
  try {
    const claims = verifyAccessToken(token);
    return { companyId: claims.companyId, userId: claims.sub };
  } catch {
    return null;
  }
}

export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header("idempotency-key");
  if (!key || !WRITE_METHODS.has(req.method) || !UUID_PATTERN.test(key)) {
    next();
    return;
  }
  const identity = companyOf(req);
  if (!identity) {
    next();
    return;
  }

  try {
    const existing = await syncRepository.findByClientUuid(key);
    if (existing) {
      const stored = existing.payload as unknown as StoredResponse | null;
      // Une clé ne vaut que pour la société et la requête qui l'ont créée.
      if (
        existing.companyId !== identity.companyId ||
        existing.entity !== HTTP_REQUEST_ENTITY ||
        !stored ||
        stored.method !== req.method ||
        stored.path !== requestPath(req)
      ) {
        res.status(409).json({
          error: "Clé d'idempotence déjà utilisée pour une autre requête.",
          code: "IDEMPOTENCY_CONFLICT",
          requestId: req.requestId,
        });
        return;
      }
      res.setHeader("Idempotent-Replayed", "true");
      if (stored.statusCode === 204 || stored.body === undefined) {
        res.status(stored.statusCode).end();
      } else {
        res.status(stored.statusCode).json(stored.body);
      }
      return;
    }
  } catch (error) {
    // Journal indisponible : on traite la requête normalement plutôt que de la bloquer.
    logger.warn("Idempotence : lecture du journal impossible", { requestId: req.requestId, error });
    next();
    return;
  }

  // La réponse est journalisée **avant** d'être envoyée : sur Vercel, la fonction peut
  // être gelée dès la réponse partie, et un journal écrit après serait perdu.
  const path = requestPath(req);
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300) return json(body);
    const serverId =
      typeof body === "object" && body !== null && typeof (body as { id?: unknown }).id === "string"
        ? (body as { id: string }).id
        : "";
    syncRepository
      .record({
        clientUuid: key,
        companyId: identity.companyId,
        userId: identity.userId,
        entity: HTTP_REQUEST_ENTITY,
        action: req.method.toLowerCase(),
        status: "created",
        serverId,
        deviceId: String(req.headers["x-device-id"] ?? ""),
        detail: `${req.method} ${path}`,
        payload: {
          method: req.method,
          path,
          statusCode: res.statusCode,
          body,
        } satisfies StoredResponse as unknown as Record<string, unknown>,
      })
      .catch((error) =>
        logger.warn("Idempotence : journalisation impossible", { requestId: req.requestId, error })
      )
      .finally(() => json(body));
    return res;
  };

  next();
}
