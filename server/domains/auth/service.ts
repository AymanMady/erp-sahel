/**
 * Application boundary of the authentication domain: validates input, normalizes
 * errors and delegates use cases to `authApplication`.
 */

import { ALL_PERMISSION_CODES } from "@shared/rbac";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../shared/errors/app-error";
import { authApplication, hashPassword, verifyPassword } from "./application";
import type {
  ChangePasswordRequestDto,
  LoginRequestDto,
  MeResponseDto,
  RefreshRequestDto,
  SessionResponseDto,
} from "./dto";
import { authRepository } from "./repository";
import { changePasswordSchema, loginSchema, refreshSchema } from "./schemas";

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
    return {
      user: context.user,
      company: context.company,
      permissions: context.user.isSuperuser ? [...ALL_PERMISSION_CODES] : context.permissions,
      modules: context.modules,
    };
  }

  async changePassword(input: ChangePasswordRequestDto): Promise<{ success: true }> {
    const data = changePasswordSchema.parse(input.body);
    const user = await this.repository.findUserById(input.userId);
    if (!user) throw new NotFoundError("User not found.");
    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Current password is incorrect.");
    }
    if (await verifyPassword(data.newPassword, user.passwordHash)) {
      throw new ValidationError("The new password must differ from the current one.");
    }
    await this.repository.updatePassword(input.userId, await hashPassword(data.newPassword));
    // Changing the password invalidates every session opened elsewhere.
    await this.application.logoutEverywhere(input.userId);
    return { success: true };
  }
}

export const authService = new AuthService();
