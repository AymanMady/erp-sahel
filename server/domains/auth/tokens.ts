/**
 * Émission et vérification des jetons [FR-AUTH-1], [NFR-SEC-1].
 *
 * - **Access token** : JWT court (15 min par défaut) portant `userId`, `companyId`,
 *   les permissions effectives et les modules actifs. Il est auto-porteur : aucune
 *   requête base n'est nécessaire pour autoriser un appel.
 * - **Refresh token** : valeur aléatoire opaque (jamais un JWT) dont **seul le SHA-256
 *   est stocké**. Rotation à chaque usage ; la révocation est donc effective côté serveur.
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
   * Présent sur les jetons dont `modules` inclut les fonctionnalités (caisse, achats…).
   * Un jeton plus ancien n'en porte pas : il ne doit pas être refusé pour autant.
   */
  featureGating?: boolean;
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "JWT_SECRET est absent ou trop court (32 caractères minimum recommandés). Voir .env.example."
    );
  }
  return value;
}

/** Vérifie au démarrage que la configuration de production est exploitable. */
export function assertTokenConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "JWT_SECRET doit faire au moins 32 caractères en production. " +
        "Générez-le : node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  if (value.startsWith("dev-secret")) {
    throw new Error("JWT_SECRET est resté sur la valeur de développement : changez-le.");
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
    throw new UnauthorizedError(expired ? "Session expirée" : "Jeton invalide");
  }
}

/** Nouveau jeton de rafraîchissement : valeur en clair pour le client, hash pour la base. */
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

/** Extrait le jeton d'un en-tête `Authorization: Bearer …`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
