/** Rate limiting — authentication first [NFR-SEC-4]. */

import type { Request } from "express";
import rateLimit, { type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";

import { pool } from "../db";
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

/**
 * Counters kept in PostgreSQL, shared by every instance. On a serverless host each
 * instance has its own memory: an in-memory counter would let an attacker spread
 * attempts over instances and never be stopped.
 */
class PostgresStore implements Store {
  localKeys = false;
  private windowMs = 60_000;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await pool.query<{ hits: number; reset_at: Date }>(
      "select hits, reset_at from rate_limit_hits where key = $1 and reset_at > now()",
      [this.prefix + key]
    );
    return rows[0] ? { totalHits: rows[0].hits, resetTime: rows[0].reset_at } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    // A window that has ended starts over at 1, in the same statement.
    const { rows } = await pool.query<{ hits: number; reset_at: Date }>(
      `insert into rate_limit_hits (key, hits, reset_at)
       values ($1, 1, now() + ($2 || ' milliseconds')::interval)
       on conflict (key) do update set
         hits = case when rate_limit_hits.reset_at <= now() then 1 else rate_limit_hits.hits + 1 end,
         reset_at = case when rate_limit_hits.reset_at <= now() then excluded.reset_at
                         else rate_limit_hits.reset_at end
       returning hits, reset_at`,
      [this.prefix + key, String(this.windowMs)]
    );
    return { totalHits: rows[0].hits, resetTime: rows[0].reset_at };
  }

  async decrement(key: string): Promise<void> {
    await pool.query("update rate_limit_hits set hits = greatest(hits - 1, 0) where key = $1", [
      this.prefix + key,
    ]);
  }

  async resetKey(key: string): Promise<void> {
    await pool.query("delete from rate_limit_hits where key = $1", [this.prefix + key]);
  }
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Login: counted per address **and** account name. A whole shop shares one public
 * address (same Internet box): one person mistyping must not lock the others out,
 * while guessing the password of one account stays slow.
 */
export const authRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 10,
  // Only failed attempts count: a shop signing in all day long is never blocked.
  skipSuccessfulRequests: true,
  // A database hiccup must not lock everybody out of the application.
  passOnStoreError: true,
  store: new PostgresStore("login:"),
  keyGenerator: (req) => {
    const username = (req.body as { username?: unknown } | undefined)?.username;
    return `${clientIp(req)}:${typeof username === "string" ? username.trim().toLowerCase() : ""}`;
  },
});

/** Upper bound per address, whatever the account: stops trying many accounts in a row. */
export const authAddressRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 100,
  skipSuccessfulRequests: true,
  passOnStoreError: true,
  store: new PostgresStore("login-ip:"),
  keyGenerator: clientIp,
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
