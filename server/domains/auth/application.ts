/**
 * Authentication use cases: login, refresh, logout, and building the
 * authorization context (permissions + enabled modules).
 */

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { ALL_PERMISSION_CODES, type PermissionCode } from "@shared/rbac";
import type { Company, PublicUser } from "@shared/schema";
import { NotFoundError, UnauthorizedError } from "../../shared/errors/app-error";
import { moduleRegistry } from "../plugins/registry";
import { companiesRepository } from "../tenancy/repository";
import { authRepository } from "./repository";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "./tokens";

export interface SessionContext {
  user: PublicUser;
  company: Company;
  permissions: PermissionCode[];
  modules: string[];
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * bcrypt cost: 12 rounds. Offline sign-in copies hashes to register computers, so a
 * stolen hash must be slow to break; 12 still answers a sign-in in a fraction of a
 * second. Older hashes are upgraded at the next sign-in.
 */
const BCRYPT_ROUNDS = 12;

/** Two tabs renewing with the same token within this delay is not a theft. */
const REFRESH_REUSE_GRACE_MS = 30_000;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Real hash of a random password, computed once: comparing against it costs as much
 * as a real check, so an unknown account name answers as slowly as a known one.
 */
let dummyHash: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
  return dummyHash;
}

function toPublicUser(user: { passwordHash: string } & Record<string, unknown>): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest as PublicUser;
}

class AuthApplication {
  constructor(private readonly repository = authRepository) {}

  /**
   * Resolves the working company: the requested one if the user belongs to it,
   * otherwise their default company. A superuser may target any company.
   */
  private async resolveCompanyId(
    userId: string,
    isSuperuser: boolean,
    requestedCompanyId?: string | null
  ): Promise<string> {
    if (requestedCompanyId) {
      if (isSuperuser || (await this.repository.hasMembership(userId, requestedCompanyId))) {
        return requestedCompanyId;
      }
      throw new UnauthorizedError("You do not have access to this company.");
    }
    const memberships = await this.repository.listMemberships(userId);
    const preferred = memberships.find((m) => m.isDefault) ?? memberships[0];
    if (preferred) return preferred.companyId;

    if (isSuperuser) {
      const [firstCompany] = await companiesRepository.listAll(1);
      if (firstCompany) return firstCompany.id;
    }
    throw new UnauthorizedError("No company is linked to this account.");
  }

  async buildContext(userId: string, requestedCompanyId?: string | null): Promise<SessionContext> {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("Account not found or disabled.");
    }
    const companyId = await this.resolveCompanyId(user.id, user.isSuperuser, requestedCompanyId);
    const company = await companiesRepository.findById(companyId);
    if (!company) throw new NotFoundError("Company not found.");

    const [permissions, modules] = await Promise.all([
      this.repository.listEffectivePermissions(user.id, companyId),
      moduleRegistry.enabledCodes(companyId),
    ]);

    return {
      user: toPublicUser(user),
      company,
      // A superuser holds every permission without any role assignment.
      permissions: user.isSuperuser ? [...ALL_PERMISSION_CODES] : (permissions as PermissionCode[]),
      modules,
    };
  }

  private async issueTokens(context: SessionContext, userAgent: string): Promise<SessionTokens> {
    const accessToken = signAccessToken({
      sub: context.user.id,
      username: context.user.username,
      companyId: context.company.id,
      isSuperuser: context.user.isSuperuser,
      permissions: context.permissions,
      modules: context.modules,
      featureGating: true,
    });
    const { token, tokenHash } = createRefreshToken();
    const expiresAt = refreshTokenExpiry();
    await this.repository.insertRefreshToken({
      userId: context.user.id,
      companyId: context.company.id,
      tokenHash,
      expiresAt,
      userAgent: userAgent.slice(0, 255),
    });
    return {
      accessToken,
      refreshToken: token,
      expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    };
  }

  async login(input: {
    username: string;
    password: string;
    companyId?: string | null;
    userAgent: string;
  }): Promise<SessionContext & { tokens: SessionTokens }> {
    const user = await this.repository.findUserByUsername(input.username);
    // Deliberately the same message whether the user exists or not: the login
    // page must not become an account-existence oracle.
    const invalid = new UnauthorizedError("Incorrect username or password.");
    if (!user || !user.isActive) {
      // Dummy comparison to keep a comparable response time.
      await bcrypt.compare(input.password, await dummyPasswordHash());
      throw invalid;
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) throw invalid;
    if (bcrypt.getRounds(user.passwordHash) < BCRYPT_ROUNDS) {
      await this.repository.updatePasswordHash(user.id, await hashPassword(input.password));
    }

    const context = await this.buildContext(user.id, input.companyId);
    const tokens = await this.issueTokens(context, input.userAgent);
    await this.repository.touchLastLogin(user.id);
    return { ...context, tokens };
  }

  /** Rotation: the old token is revoked at the very moment the new one is issued. */
  async refresh(input: {
    refreshToken: string;
    companyId?: string | null;
    userAgent: string;
  }): Promise<SessionContext & { tokens: SessionTokens }> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.repository.consumeRefreshToken(tokenHash);
    if (stored) {
      const context = await this.buildContext(stored.userId, input.companyId ?? stored.companyId);
      const tokens = await this.issueTokens(context, input.userAgent);
      return { ...context, tokens };
    }

    const known = await this.repository.findRefreshToken(tokenHash);
    const sinceRotation = known?.rotatedAt ? Date.now() - known.rotatedAt.getTime() : null;
    // The same token exchanged twice within a few seconds: two tabs (or a page and its
    // reload) of the same browser renewing together. Both get a session.
    if (
      known &&
      sinceRotation !== null &&
      sinceRotation <= REFRESH_REUSE_GRACE_MS &&
      known.expiresAt.getTime() > Date.now()
    ) {
      const user = await this.repository.findUserById(known.userId);
      const signedOutSince =
        user?.sessionsValidAfter && known.rotatedAt && user.sessionsValidAfter > known.rotatedAt;
      if (!signedOutSince) {
        const context = await this.buildContext(known.userId, input.companyId ?? known.companyId);
        const tokens = await this.issueTokens(context, input.userAgent);
        return { ...context, tokens };
      }
    }
    // A token exchanged long ago coming back means someone kept a copy of it: end every
    // session of that account.
    if (sinceRotation !== null && sinceRotation > REFRESH_REUSE_GRACE_MS) {
      await this.logoutEverywhere(known!.userId);
    }
    throw new UnauthorizedError("Session expired, please sign in again.");
  }

  async logout(refreshToken: string | null | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.repository.revokeRefreshToken(hashRefreshToken(refreshToken));
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId);
  }
}

export const authApplication = new AuthApplication();
