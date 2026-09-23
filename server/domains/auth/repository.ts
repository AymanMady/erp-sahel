/** Persistance du domaine authentification : utilisateurs, rôles, sessions. */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  companies,
  companyPlugins,
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

  /** Sociétés auxquelles l'utilisateur est rattaché, société par défaut en tête. */
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
      .where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
      .limit(1);
    return Boolean(row);
  }

  /** Permissions effectives de l'utilisateur **dans une société** ([FR-AUTH-2]). */
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
          // Un rôle est soit système (companyId nul), soit propre à cette société.
          or(isNull(roles.companyId), eq(roles.companyId, companyId))
        )
      );
    return rows.map((row) => row.code);
  }

  /** Modules activés pour la société — sert la garde d'activation ([BR-12]). */
  async listEnabledModules(companyId: string): Promise<string[]> {
    const rows = await this.database
      .select({ code: companyPlugins.pluginCode })
      .from(companyPlugins)
      .where(and(eq(companyPlugins.companyId, companyId), eq(companyPlugins.isEnabled, true)));
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

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.database
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /** Sociétés de l'utilisateur, avec leur identité — alimente le sélecteur de société. */
  async listUserCompanies(userId: string) {
    return this.database
      .select({
        id: companies.id,
        name: companies.name,
        subdomain: companies.subdomain,
        isDefault: userCompanies.isDefault,
      })
      .from(userCompanies)
      .innerJoin(companies, eq(companies.id, userCompanies.companyId))
      .where(and(eq(userCompanies.userId, userId), eq(companies.isActive, true)))
      .orderBy(companies.name);
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

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.database
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.database
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /** Purge des sessions expirées — appelée au démarrage, sans worker dédié. */
  async purgeExpiredTokens(): Promise<number> {
    const deleted = await this.database
      .delete(refreshTokens)
      .where(sql`${refreshTokens.expiresAt} < now()`)
      .returning({ id: refreshTokens.id });
    return deleted.length;
  }
}

export const authRepository = new AuthRepository();
