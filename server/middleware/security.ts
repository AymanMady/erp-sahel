/**
 * En-têtes de sécurité et CORS [NFR-SEC-3], [NFR-SEC-4].
 *
 * La CSP autorise `asset:` afin que la coquille Tauri puisse afficher les vignettes
 * produit mises en cache localement pour le mode hors-ligne.
 */

import type { NextFunction, Request, Response } from "express";

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const DEV_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
/** Origines de la coquille desktop (Tauri) selon la plateforme. */
const DESKTOP_ORIGIN_PATTERN =
  /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|https?:\/\/asset\.localhost)$/;

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // requête même-origine ou client non navigateur
  if (allowedOrigins().includes(origin)) return true;
  if (DESKTOP_ORIGIN_PATTERN.test(origin)) return true;
  if (process.env.NODE_ENV !== "production" && DEV_ORIGIN_PATTERN.test(origin)) return true;
  return false;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin) && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Company-Id, X-Device-Id, X-Device-Platform, X-Request-Id, Idempotency-Key"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https: asset: http://asset.localhost",
        "font-src 'self' data:",
        "connect-src 'self' https: http://localhost:* ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
  }
  next();
}
