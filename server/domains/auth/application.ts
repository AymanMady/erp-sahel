/**
 * Cas d'usage d'authentification : connexion, rafraîchissement, déconnexion,
 * et construction du contexte d'autorisation (permissions + modules actifs).
 */

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

/** Coût bcrypt : 10 tours, compromis usuel entre résistance et latence de connexion. */
const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function toPublicUser(user: { passwordHash: string } & Record<string, unknown>): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest as PublicUser;
}

class AuthApplication {
  constructor(private readonly repository = authRepository) {}

  /**
   * Résout la société de travail : celle demandée si l'utilisateur y est rattaché,
   * sinon sa société par défaut. Un superuser peut cibler n'importe quelle société.
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
      throw new UnauthorizedError("Vous n'avez pas accès à cette société.");
    }
    const memberships = await this.repository.listMemberships(userId);
    const preferred = memberships.find((m) => m.isDefault) ?? memberships[0];
    if (preferred) return preferred.companyId;

    if (isSuperuser) {
      const [firstCompany] = await companiesRepository.listAll(1);
      if (firstCompany) return firstCompany.id;
    }
    throw new UnauthorizedError("Aucune société n'est rattachée à ce compte.");
  }

  async buildContext(userId: string, requestedCompanyId?: string | null): Promise<SessionContext> {
    const user = await this.repository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("Compte introuvable ou désactivé.");
    }
    const companyId = await this.resolveCompanyId(user.id, user.isSuperuser, requestedCompanyId);
    const company = await companiesRepository.findById(companyId);
    if (!company) throw new NotFoundError("Société introuvable.");

    const [permissions, modules] = await Promise.all([
      this.repository.listEffectivePermissions(user.id, companyId),
      moduleRegistry.enabledCodes(companyId),
    ]);

    return {
      user: toPublicUser(user),
      company,
      // Un superuser porte l'intégralité des permissions sans affectation de rôle.
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
    // Message volontairement identique que l'utilisateur existe ou non : ne pas
    // transformer la page de connexion en oracle d'existence de comptes.
    const invalid = new UnauthorizedError("Identifiant ou mot de passe incorrect.");
    if (!user || !user.isActive) {
      // Comparaison à vide pour conserver un temps de réponse comparable.
      await bcrypt.compare(input.password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv");
      throw invalid;
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) throw invalid;

    const context = await this.buildContext(user.id, input.companyId);
    const tokens = await this.issueTokens(context, input.userAgent);
    await this.repository.touchLastLogin(user.id);
    return { ...context, tokens };
  }

  /** Rotation : l'ancien jeton est révoqué au moment même où le nouveau est émis. */
  async refresh(input: {
    refreshToken: string;
    companyId?: string | null;
    userAgent: string;
  }): Promise<SessionContext & { tokens: SessionTokens }> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.repository.findRefreshToken(tokenHash);
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Session expirée, reconnectez-vous.");
    }
    await this.repository.revokeRefreshToken(tokenHash);
    const context = await this.buildContext(stored.userId, input.companyId ?? stored.companyId);
    const tokens = await this.issueTokens(context, input.userAgent);
    return { ...context, tokens };
  }

  async logout(refreshToken: string | null | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.repository.revokeRefreshToken(hashRefreshToken(refreshToken));
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId);
  }

  /** Bascule de société sans ressaisie du mot de passe (multi-société). */
  async switchCompany(input: {
    userId: string;
    companyId: string;
    userAgent: string;
  }): Promise<SessionContext & { tokens: SessionTokens }> {
    const context = await this.buildContext(input.userId, input.companyId);
    const tokens = await this.issueTokens(context, input.userAgent);
    return { ...context, tokens };
  }
}

export const authApplication = new AuthApplication();
