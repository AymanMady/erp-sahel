/** Persistence of the authentication domain: users, roles, sessions. */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  permissions as permissionsTable,
  refreshTokens,
  rolePermissions,
  roles,
  userCompanies,
  userRoles,
  users,
} from "@shared/schema";
import { db, type Database } from "../../db";

export class AuthRepository {
  constructor(private readonly database: Database = db) {}

  async findUserByUsername(username: string) {
    const [row] = await this.database
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    return row ?? null;
  }

  async findUserById(userId: string) {
    const [row] = await this.database.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.database
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /** Companies the user belongs to, default company first. */
  async listMemberships(userId: string) {
    return this.database
      .select({
        companyId: userCompanies.companyId,
        isDefault: userCompanies.isDefault,
      })
      .from(userCompanies)
      .where(and(eq(userCompanies.userId, userId), eq(userCompanies.isActive, true)));
  }

  async hasMembership(userId: string, companyId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: userCompanies.id })
      .from(userCompanies)
      .where(
        and(
          eq(userCompanies.userId, userId),
          eq(userCompanies.companyId, companyId),
          eq(userCompanies.isActive, true)
        )
      )
      .limit(1);
    return Boolean(row);
  }

  /** Effective permissions of the user **within a company** ([FR-AUTH-2]). */
  async listEffectivePermissions(userId: string, companyId: string): Promise<string[]> {
    const rows = await this.database
      .selectDistinct({ code: permissionsTable.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.companyId, companyId),
          // A deleted role (soft-deleted) no longer grants anything.
          eq(roles.isActive, true),
          // A role is either a system role (null companyId) or specific to this company.
          or(isNull(roles.companyId), eq(roles.companyId, companyId))
        )
      );
    return rows.map((row) => row.code);
  }

  async listRoleIds(roleSlugs: string[], companyId: string): Promise<string[]> {
    if (roleSlugs.length === 0) return [];
    const rows = await this.database
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          inArray(roles.slug, roleSlugs),
          or(isNull(roles.companyId), eq(roles.companyId, companyId))
        )
      );
    return rows.map((row) => row.id);
  }

  /** Same password, stronger hash: sessions stay open. */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.database.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  /** Sets a new password and invalidates every session opened before now. */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const now = new Date();
    await this.database
      .update(users)
      .set({ passwordHash, mustChangePassword: false, sessionsValidAfter: now, updatedAt: now })
      .where(eq(users.id, userId));
  }

  async insertRefreshToken(input: {
    userId: string;
    companyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string;
  }): Promise<void> {
    await this.database.insert(refreshTokens).values(input);
  }

  async findRefreshToken(tokenHash: string) {
    const [row] = await this.database
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  /**
   * Uses a refresh token: revokes it **in the same statement** that checks it is still
   * valid. Of two requests presenting the same token at once, only one gets the row.
   */
  async consumeRefreshToken(tokenHash: string) {
    const now = new Date();
    const [row] = await this.database
      .update(refreshTokens)
      .set({ revokedAt: now, rotatedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > now()`
        )
      )
      .returning();
    return row ?? null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.database
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  /** Ends every session of the user, access tokens included. */
  async revokeAllForUser(userId: string): Promise<void> {
    const now = new Date();
    await this.database
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await this.database
      .update(users)
      .set({ sessionsValidAfter: now, updatedAt: now })
      .where(eq(users.id, userId));
  }

  /**
   * What decides, on every request, whether a session is still valid: the account,
   * its membership of the company and its current permissions.
   */
  async loadSessionState(userId: string, companyId: string) {
    const [user] = await this.database
      .select({
        isActive: users.isActive,
        isSuperuser: users.isSuperuser,
        sessionsValidAfter: users.sessionsValidAfter,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return null;
    const isMember = user.isSuperuser || (await this.hasMembership(userId, companyId));
    const permissions = isMember ? await this.listEffectivePermissions(userId, companyId) : [];
    return { ...user, isMember, permissions };
  }

  /** Purges expired sessions — called at startup, without a dedicated worker. */
  async purgeExpiredTokens(): Promise<number> {
    const deleted = await this.database
      .delete(refreshTokens)
      .where(sql`${refreshTokens.expiresAt} < now()`)
      .returning({ id: refreshTokens.id });
    return deleted.length;
  }
}

export const authRepository = new AuthRepository();
