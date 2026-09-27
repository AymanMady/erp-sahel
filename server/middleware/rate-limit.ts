/** Rate limiting — authentication first [NFR-SEC-4]. */

import rateLimit from "express-rate-limit";

import { tr } from "../shared/i18n";

const disabled = process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true";

const baseOptions = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  skip: () => disabled,
  // A function, so the message is translated into the locale of each request.
  message: () => ({
    error: tr("Too many requests. Please try again in a moment."),
    code: "RATE_LIMITED",
  }),
};

/** Login: short window and low quota to counter credential stuffing. */
export const authRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 20,
});

/**
 * Whole API, per IP address. Several devices of the same shop usually share one
 * public address (same Internet box), and each one fills its offline cache in the
 * background: the quota must cover them all.
 */
export const apiRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 1500,
});

/**
 * Synchronization: high quota and wide window. A device coming back after a long
 * outage pushes several batches in a row; throttling it would delay data convergence,
 * which is exactly what we want to avoid.
 */
export const syncRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 240,
});
