/**
 * Idempotency of HTTP writes replayed from the device's offline queue.
 *
 * When the network drops during a write, the client does not know whether the server
 * processed it; it queues it and replays it later with the **same** `Idempotency-Key`.
 * The key is **taken before** the request runs (a `pending` row in `sync_operations`,
 * entity `http.request`): a second copy arriving meanwhile is told to try again later
 * instead of running a second time. The first successful response is then stored: a
 * replay receives it as is, without writing again ([BR-8]). A failure frees the key, so
 * the request remains retryable; an empty response (deletion) replays harmlessly — the
 * client treats a replayed 404 as a success.
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
  const path = requestPath(req);

  let holder;
  try {
    holder = await syncRepository.claimHttpKey({
      clientUuid: key,
      companyId: identity.companyId,
      userId: identity.userId,
      entity: HTTP_REQUEST_ENTITY,
      action: req.method.toLowerCase(),
      status: "pending",
      deviceId: String(req.headers["x-device-id"] ?? "").slice(0, 128),
      detail: `${req.method} ${path}`,
      payload: { method: req.method, path },
    });
  } catch (error) {
    // Log unavailable: process the request normally rather than blocking it.
    logger.warn("Idempotency: unable to read the log", { requestId: req.requestId, error });
    next();
    return;
  }

  if (holder) {
    const stored = holder.payload as unknown as Partial<StoredResponse> | null;
    // A key is only valid for the company and the request that created it.
    if (
      holder.companyId !== identity.companyId ||
      holder.entity !== HTTP_REQUEST_ENTITY ||
      !stored ||
      stored.method !== req.method ||
      stored.path !== path
    ) {
      res.status(409).json({
        error: tr("Idempotency key already used for another request."),
        code: "IDEMPOTENCY_CONFLICT",
        requestId: req.requestId,
      });
      return;
    }
    if (holder.status === "pending") {
      // The first copy is still running: the device will try again shortly and then
      // receive its response.
      res.setHeader("Retry-After", "2");
      res.status(503).json({
        error: tr("This request is already being processed. Please try again in a moment."),
        code: "IDEMPOTENCY_IN_PROGRESS",
        requestId: req.requestId,
      });
      return;
    }
    res.setHeader("Idempotent-Replayed", "true");
    if (stored.statusCode === 204 || stored.body === undefined) {
      res.status(stored.statusCode ?? 200).end();
    } else {
      res.status(stored.statusCode ?? 200).json(stored.body);
    }
    return;
  }

  // From here the key is held by this request: it is either completed with the
  // response, or freed.
  let settled = false;
  const release = () => {
    if (settled) return;
    settled = true;
    syncRepository
      .releaseHttpKey(key)
      .catch((error: unknown) =>
        logger.warn("Idempotency: unable to free the key", { requestId: req.requestId, error })
      );
  };
  // Response ended without going through `res.json` (error page, empty body, client gone).
  res.on("finish", release);
  res.on("close", release);

  // The response is logged **before** being sent: on Vercel the function may be frozen
  // as soon as the response is out, and a log written afterwards would be lost.
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      release();
      return json(body);
    }
    settled = true;
    const serverId =
      typeof body === "object" && body !== null && typeof (body as { id?: unknown }).id === "string"
        ? (body as { id: string }).id
        : "";
    syncRepository
      .completeHttpKey(key, {
        serverId,
        payload: {
          method: req.method,
          path,
          statusCode: res.statusCode,
          body,
        } satisfies StoredResponse as unknown as Record<string, unknown>,
      })
      .catch((error: unknown) =>
        logger.warn("Idempotency: unable to store the response", {
          requestId: req.requestId,
          error,
        })
      )
      .finally(() => json(body));
    return res;
  };

  next();
}
