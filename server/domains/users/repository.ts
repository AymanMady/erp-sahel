/** Persistance de l'administration des utilisateurs et des rôles. */

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  permissions,
  rolePermissions,
  roles,
  userCompanies,
  userRoles,
  users,
  type PublicUser,
  type Role,
} from "@shared/schema";
import { db, type Database } from "../../db";

export class UsersRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): UsersRepository {
    return new UsersRepository(tx);
  }

  /** Utilisateurs rattachés à la société, rôles inclus. */
  async listForCompany(companyId: string): Promise<(PublicUser & { roles: Role[] })[]> {
    const memberRows = await this.database
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        isSuperuser: users.isSuperuser,
        allowOfflineLogin: users.allowOfflineLogin,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(userCompanies)
      .innerJoin(users, eq(users.id, userCompanies.userId))
      .where(eq(userCompanies.companyId, companyId))
      .orderBy(asc(users.username));

    if (memberRows.length === 0) return [];

    const roleRows = await this.database
      .select({ userId: userRoles.userId, role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.companyId, companyId),
          inArray(
            userRoles.userId,
            memberRows.map((row) => row.id)
          )
        )
      );

    const rolesByUser = new Map<string, Role[]>();
    for (const row of roleRows) {
      const bucket = rolesByUser.get(row.userId) ?? [];
      bucket.push(row.role);
      rolesByUser.set(row.userId, bucket);
    }

    return memberRows.map((row) => ({
      ...(row as PublicUser),
      roles: rolesByUser.get(row.id) ?? [],
    }));
  }

  async insertUser(values: typeof users.$inferInsert) {
    const [row] = await this.database.insert(users).values(values).returning();
    return row;
  }

  async updateUser(userId: string, patch: Partial<typeof users.$inferInsert>) {
    const [row] = await this.database
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return row ?? null;
  }

  async addMembership(userId: string, companyId: string, isDefault = false): Promise<void> {
    await this.database
      .insert(userCompanies)
      .values({ userId, companyId, isDefault })
      .onConflictDoNothing();
  }

  async isMember(userId: string, companyId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: userCompanies.id })
      .from(userCompanies)
      .where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
      .limit(1);
    return Boolean(row);
  }

  /** Remplace les rôles d'un utilisateur dans une société. */
  async setUserRoles(userId: string, companyId: string, roleIds: string[]): Promise<void> {
    await this.database
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId)));
    if (roleIds.length === 0) return;
    await this.database
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ userId, roleId, companyId })))
      .onConflictDoNothing();
  }

  /** Rôles visibles par la société : les siens plus les rôles système. */
  async listRoles(companyId: string) {
    const rows = await this.database
      .select({ role: roles, permissionCode: permissions.code })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(or(isNull(roles.companyId), eq(roles.companyId, companyId)))
      .orderBy(asc(roles.name));

    const byRole = new Map<string, { role: Role; permissions: string[] }>();
    for (const row of rows) {
      const entry = byRole.get(row.role.id) ?? { role: row.role, permissions: [] };
      if (row.permissionCode) entry.permissions.push(row.permissionCode);
      byRole.set(row.role.id, entry);
    }
    return [...byRole.values()].map((entry) => ({ ...entry.role, permissions: entry.permissions }));
  }

  async findRole(companyId: string, roleId: string) {
    const [row] = await this.database
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), or(isNull(roles.companyId), eq(roles.companyId, companyId))))
      .limit(1);
    return row ?? null;
  }

  async insertRole(values: typeof roles.$inferInsert) {
    const [row] = await this.database.insert(roles).values(values).returning();
    return row;
  }

  async updateRole(roleId: string, patch: Partial<typeof roles.$inferInsert>) {
    const [row] = await this.database
      .update(roles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(roles.id, roleId))
      .returning();
    return row ?? null;
  }

  async setRolePermissions(roleId: string, permissionCodes: string[]): Promise<void> {
    await this.database.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionCodes.length === 0) return;
    const permissionRows = await this.database
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.code, permissionCodes));
    if (permissionRows.length === 0) return;
    await this.database
      .insert(rolePermissions)
      .values(permissionRows.map((row) => ({ roleId, permissionId: row.id })))
      .onConflictDoNothing();
  }

  async listPermissions() {
    return this.database.select().from(permissions).orderBy(asc(permissions.code));
  }

  async countRoleAssignments(roleId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    return row?.value ?? 0;
  }

  async findByUsername(username: string) {
    const [row] = await this.database
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    return row ?? null;
  }
}

export const usersRepository = new UsersRepository();
