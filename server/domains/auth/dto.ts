/** Contrats typés entre contrôleur et service du domaine authentification. */

import type { Company, PublicUser } from "@shared/schema";
import type { PermissionCode } from "@shared/rbac";

export interface SessionResponseDto {
  user: PublicUser;
  company: Company;
  permissions: PermissionCode[];
  modules: string[];
  accessToken: string;
  refreshToken: string;
  /** Durée de vie du refresh token, en secondes. */
  expiresIn: number;
}

export interface MeResponseDto {
  user: PublicUser;
  company: Company;
  companies: { id: string; name: string; subdomain: string }[];
  permissions: PermissionCode[];
  modules: string[];
}

export interface LoginRequestDto {
  body: unknown;
  userAgent: string;
}

export interface RefreshRequestDto {
  body: unknown;
  userAgent: string;
}

export interface ChangePasswordRequestDto {
  userId: string;
  body: unknown;
}
