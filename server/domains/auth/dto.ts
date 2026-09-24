/** Typed contracts between the controller and the service of the authentication domain. */

import type { Company, PublicUser } from "@shared/schema";
import type { PermissionCode } from "@shared/rbac";

export interface SessionResponseDto {
  user: PublicUser;
  company: Company;
  permissions: PermissionCode[];
  modules: string[];
  accessToken: string;
  refreshToken: string;
  /** Refresh token lifetime, in seconds. */
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
