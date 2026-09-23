/** Conversion des exceptions en réponses JSON normalisées. */

import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { isDatabaseConnectivityError } from "../db";
import {
  AppError,
  ServiceUnavailableError,
  ValidationError,
  translateDatabaseError,
} from "../shared/errors/app-error";
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
    return new ValidationError("Données invalides", error.errors);
  }
  if (isDatabaseConnectivityError(error)) {
    return new ServiceUnavailableError(
      "Base de données momentanément injoignable. Réessayez dans un instant.",
      "DB_CONNECTION"
    );
  }
  const translated = translateDatabaseError(error);
  if (translated) return translated;
  return new AppError(error instanceof Error ? error.message : "Erreur interne du serveur");
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
    // Un 500 ne divulgue jamais le message interne au client.
    error: isServerFault ? "Erreur interne du serveur" : appError.message,
    code: appError.code,
    requestId: req.requestId,
  };
  // Les détails de validation restent utiles au client ; les détails d'une 500, non.
  if (appError.details !== undefined && !isServerFault) {
    body.details = appError.details;
  }

  res.status(appError.status).json(body);
}

/** 404 pour toute route `/api` inconnue (les autres chemins servent la SPA). */
export function apiNotFound(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }
  res.status(404).json({
    error: `Endpoint inconnu : ${req.method} ${req.path}`,
    code: "NOT_FOUND",
    requestId: req.requestId,
  } satisfies ErrorEnvelope);
}
