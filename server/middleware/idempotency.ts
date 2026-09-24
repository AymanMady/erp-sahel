/**
 * Idempotency of HTTP writes replayed from the device's offline queue.
 *
 * When the network drops during a write, the client does not know whether the server
 * processed it; it queues it and replays it later with the **same** `Idempotency-Key`.
 * The first successful response is logged in `sync_operations` (entity `http.request`):
 * a replay receives that response as is, without writing again ([BR-8]). Only successful
 * JSON responses are logged: a failure must remain retryable, and an empty response
 * (deletion) replays harmlessly — the client treats a replayed 404 as a success.
 */

import type { NextFunction, Request, Response } from "express";

import { bearerToken, verifyAccessToken } from "../domains/auth/tokens";
import { syncRepository } from "../domains/sync/repository";
import { tr } from "../shared/i18n";
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

/** Full path (without query string), independent of the middleware mount point. */
function requestPath(req: Request): string {
  return req.originalUrl.split("?")[0];
}

/** Company of the token, without throwing: the route alone decides on authentication. */
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
      // A key is only valid for the company and the request that created it.
      if (
        existing.companyId !== identity.companyId ||
        existing.entity !== HTTP_REQUEST_ENTITY ||
        !stored ||
        stored.method !== req.method ||
        stored.path !== requestPath(req)
      ) {
        res.status(409).json({
          error: tr("Idempotency key already used for another request."),
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
    // Log unavailable: process the request normally rather than blocking it.
    logger.warn("Idempotency: unable to read the log", { requestId: req.requestId, error });
    next();
    return;
  }

  // The response is logged **before** being sent: on Vercel the function may be frozen
  // as soon as the response is out, and a log written afterwards would be lost.
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
