/** Utilitaires de la frontière HTTP. */

import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Enveloppe un handler asynchrone pour router les rejets vers `errorHandler`.
 * Express 5 le fait nativement, mais l'enveloppe reste explicite — elle documente
 * l'intention et protège si le projet est rétroporté sur Express 4.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Pagination normalisée pour toutes les listes de l'API. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number
): Paginated<T> {
  return { items, total, limit, offset };
}
