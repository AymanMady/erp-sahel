/**
 * Frontière applicative du domaine authentification : valide les entrées, normalise
 * les erreurs et délègue les cas d'usage à `authApplication`.
 */

import { ALL_PERMISSION_CODES } from "@shared/rbac";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../shared/errors/app-error";
import { companiesRepository } from "../tenancy/repository";
import { authApplication, hashPassword, verifyPassword } from "./application";
import type {
  ChangePasswordRequestDto,
  LoginRequestDto,
  MeResponseDto,
  RefreshRequestDto,
  SessionResponseDto,
} from "./dto";
import { authRepository } from "./repository";
import { changePasswordSchema, loginSchema, refreshSchema, switchCompanySchema } from "./schemas";

export class AuthService {
  constructor(
    private readonly application = authApplication,
    private readonly repository = authRepository
  ) {}

  async login(input: LoginRequestDto): Promise<SessionResponseDto> {
    const data = loginSchema.parse(input.body);
    const session = await this.application.login({
      username: data.username,
      password: data.password,
      companyId: data.companyId,
      userAgent: input.userAgent,
    });
    return {
      user: session.user,
      company: session.company,
      permissions: session.permissions,
      modules: session.modules,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
    };
  }

  async refresh(input: RefreshRequestDto): Promise<SessionResponseDto> {
    const data = refreshSchema.parse(input.body);
    const session = await this.application.refresh({
      refreshToken: data.refreshToken,
      companyId: data.companyId,
      userAgent: input.userAgent,
    });
    return {
      user: session.user,
      company: session.company,
      permissions: session.permissions,
      modules: session.modules,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
    };
  }

  async logout(body: unknown): Promise<{ success: true }> {
    const refreshToken =
      body && typeof body === "object" && "refreshToken" in body
        ? String((body as { refreshToken?: unknown }).refreshToken ?? "")
        : "";
    await this.application.logout(refreshToken || null);
    return { success: true };
  }

  async me(userId: string, companyId: string): Promise<MeResponseDto> {
    const context = await this.application.buildContext(userId, companyId);
    const companies = await this.repository.listUserCompanies(userId);
    return {
      user: context.user,
      company: context.company,
      // Un superuser voit toutes les sociétés, pas seulement celles où il est membre.
      companies: context.user.isSuperuser
        ? (await companiesRepository.listAll()).map((c) => ({
            id: c.id,
            name: c.name,
            subdomain: c.subdomain,
          }))
        : companies.map((c) => ({ id: c.id, name: c.name, subdomain: c.subdomain })),
      permissions: context.user.isSuperuser ? [...ALL_PERMISSION_CODES] : context.permissions,
      modules: context.modules,
    };
  }

  async switchCompany(input: {
    userId: string;
    body: unknown;
    userAgent: string;
  }): Promise<SessionResponseDto> {
    const data = switchCompanySchema.parse(input.body);
    const company = await companiesRepository.findById(data.companyId);
    if (!company) throw new NotFoundError("Société introuvable.");
    const session = await this.application.switchCompany({
      userId: input.userId,
      companyId: data.companyId,
      userAgent: input.userAgent,
    });
    return {
      user: session.user,
      company: session.company,
      permissions: session.permissions,
      modules: session.modules,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
    };
  }

  async changePassword(input: ChangePasswordRequestDto): Promise<{ success: true }> {
    const data = changePasswordSchema.parse(input.body);
    const user = await this.repository.findUserById(input.userId);
    if (!user) throw new NotFoundError("Utilisateur introuvable.");
    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Mot de passe actuel incorrect.");
    }
    if (await verifyPassword(data.newPassword, user.passwordHash)) {
      throw new ValidationError("Le nouveau mot de passe doit différer de l'actuel.");
    }
    await this.repository.updatePassword(input.userId, await hashPassword(data.newPassword));
    // Changer de mot de passe invalide toutes les sessions ouvertes ailleurs.
    await this.application.logoutEverywhere(input.userId);
    return { success: true };
  }
}

export const authService = new AuthService();
