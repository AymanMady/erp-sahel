/** Converts exceptions into normalized JSON responses, translated into the request locale. */

import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { isDatabaseConnectivityError } from "../db";
import {
  AppError,
  ServiceUnavailableError,
  ValidationError,
  translateDatabaseError,
} from "../shared/errors/app-error";
import { lookup, tr } from "../shared/i18n";
import { logger } from "../shared/logging/logger";

export interface ErrorEnvelope {
  error: string;
  code: string;
  requestId?: string;
  details?: unknown;
}

function normalize(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new ValidationError("Invalid data", error.errors);
  }
  if (isDatabaseConnectivityError(error)) {
    return new ServiceUnavailableError(
      "Database temporarily unreachable. Please try again in a moment.",
      "DB_CONNECTION"
    );
  }
  const translated = translateDatabaseError(error);
  if (translated) return translated;
  return new AppError(error instanceof Error ? error.message : "Internal server error");
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalize(error);
  const isServerFault = appError.status >= 500;

  logger[isServerFault ? "error" : "warn"](appError.message, {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status: appError.status,
    code: appError.code,
    ...(isServerFault && error instanceof Error ? { stack: error.stack } : {}),
  });

  const body: ErrorEnvelope = {
    // A 500 never leaks the internal message to the client.
    error: lookup(isServerFault ? "Internal server error" : appError.message),
    code: appError.code,
    requestId: req.requestId,
  };
  // Validation details stay useful to the client; the details of a 500 do not.
  if (appError.details !== undefined && !isServerFault) {
    body.details = translateIssues(appError.details);
  }

  res.status(appError.status).json(body);
}

/** Translates the messages of serialized Zod issues (written in English in the schemas). */
function translateIssues(details: unknown): unknown {
  if (!Array.isArray(details)) return details;
  return details.map((issue) =>
    issue &&
    typeof issue === "object" &&
    typeof (issue as { message?: unknown }).message === "string"
      ? { ...issue, message: lookup((issue as { message: string }).message) }
      : issue
  );
}

/** 404 for any unknown `/api` route (other paths serve the SPA). */
export function apiNotFound(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }
  res.status(404).json({
    error: tr("Unknown endpoint: {method} {path}", { method: req.method, path: req.path }),
    code: "NOT_FOUND",
    requestId: req.requestId,
  } satisfies ErrorEnvelope);
}
