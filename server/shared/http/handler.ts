/** HTTP boundary utilities. */

import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async handler to route rejections to `errorHandler`.
 * Express 5 does it natively, but the wrapper stays explicit — it documents the
 * intent and protects the code if the project is ever backported to Express 4.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Normalized pagination for every API list. */
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
