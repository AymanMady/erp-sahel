/**
 * Token issuance and verification [FR-AUTH-1], [NFR-SEC-1].
 *
 * - **Access token**: short-lived JWT (15 min by default) carrying `userId`, `companyId`,
 *   the effective permissions and the enabled modules. It is self-contained: no database
 *   query is needed to authorize a call.
 * - **Refresh token**: opaque random value (never a JWT) of which **only the SHA-256
 *   is stored**. Rotated on every use, so revocation is effective server-side.
 */

import { createHash, randomBytes } from "node:crypto";

import jwt from "jsonwebtoken";

import type { PermissionCode } from "@shared/rbac";
import { UnauthorizedError } from "../../shared/errors/app-error";

export interface AccessTokenClaims {
  sub: string;
  username: string;
  companyId: string;
  isSuperuser: boolean;
  permissions: PermissionCode[];
  modules: string[];
  /**
   * Present on tokens whose `modules` include features (POS, purchasing…).
   * Older tokens do not carry it: they must not be rejected because of that.
   */
  featureGating?: boolean;
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "JWT_SECRET is missing or too short (at least 32 characters recommended). See .env.example."
    );
  }
  return value;
}

/** Checks at startup that the production configuration is usable. */
export function assertTokenConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters long in production. " +
        "Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  if (value.startsWith("dev-secret")) {
    throw new Error("JWT_SECRET still has the development value: change it.");
  }
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, secret(), {
    expiresIn: process.env.ACCESS_TOKEN_TTL ?? "15m",
    issuer: "erp-sahel",
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, secret(), { issuer: "erp-sahel" }) as AccessTokenClaims;
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw new UnauthorizedError(expired ? "Session expired" : "Invalid token");
  }
}

/** New refresh token: plain value for the client, hash for the database. */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Extracts the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
