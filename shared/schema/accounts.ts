/**
 * Users, roles, permissions (RBAC) and audit log.
 *
 * A permission is always evaluated **for a user within a company**
 * (`user_roles` carries `company_id`): an accountant of company A has no rights in
 * company B ([FR-AUTH-2], [NFR-SEC-2]).
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { auditTimestamps, baseColumns } from "./_base";
import { companies } from "./tenancy";

export const users = pgTable(
  "users",
  {
    ...baseColumns,
    username: text("username").notNull(),
    email: text("email").default("").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").default("").notNull(),
    lastName: text("last_name").default("").notNull(),
    phone: text("phone").default("").notNull(),
    avatarUrl: text("avatar_url"),
    /** Platform super-administrator: bypasses RBAC (never created by the tenant UI). */
    isSuperuser: boolean("is_superuser").default(false).notNull(),
    /** Allows offline login on the workstation (the bcrypt hash is included in the POS snapshot). */
    allowOfflineLogin: boolean("allow_offline_login").default(true).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_users_username").on(table.username),
    index("idx_users_email").on(table.email),
  ]
);

export const insertUserSchema = createInsertSchema(users, {
  username: (s) => s.min(3, "At least 3 characters"),
  email: (s) => s.email("Adresse e-mail invalide").or(z.literal("")),
}).omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
/** User as exposed by the API: never includes `passwordHash`. */
export type PublicUser = Omit<User, "passwordHash">;

export const permissions = pgTable(
  "permissions",
  {
    ...baseColumns,
    /** `module.action` code (e.g. `invoicing.write`). */
    code: text("code").notNull(),
    label: text("label").default("").notNull(),
    /** Owning module — a plugin declares its own permissions [FR-PLUG-1]. */
    moduleCode: text("module_code").default("core").notNull(),
  },
  (table) => [uniqueIndex("uq_permissions_code").on(table.code)]
);

export type Permission = typeof permissions.$inferSelect;

export const roles = pgTable(
  "roles",
  {
    ...baseColumns,
    /** `null` = system role shared by all companies (Administrator, Salesperson…). */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").default("").notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("uq_roles_company_slug").on(table.companyId, table.slug),
    // PostgreSQL treats two NULLs as distinct: without this partial index, system
    // roles (`company_id IS NULL`) could be duplicated each time the seed is re-run.
    uniqueIndex("uq_roles_system_slug")
      .on(table.slug)
      .where(sql`${table.companyId} is null`),
  ]
);

export type Role = typeof roles.$inferSelect;

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]
);

export type RolePermission = typeof rolePermissions.$inferSelect;

/** Assignment of a user to a company (membership). */
export const userCompanies = pgTable(
  "user_companies",
  {
    ...baseColumns,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_user_companies").on(table.userId, table.companyId)]
);

export type UserCompany = typeof userCompanies.$inferSelect;

/** Role assignment scoped to a company. */
export const userRoles = pgTable(
  "user_roles",
  {
    ...baseColumns,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("uq_user_roles").on(table.userId, table.roleId, table.companyId)]
);

export type UserRole = typeof userRoles.$inferSelect;

/** User ↔ allowed store assignment [FR-AUTH-4]. */
export const userWarehouses = pgTable(
  "user_warehouses",
  {
    ...baseColumns,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
  },
  (table) => [uniqueIndex("uq_user_warehouses").on(table.userId, table.warehouseId)]
);

/**
 * Refresh tokens: rotation and revocation [NFR-SEC-1].
 * Only the token's SHA-256 is stored — a database leak does not allow replaying a session.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent").default("").notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex("uq_refresh_tokens_hash").on(table.tokenHash),
    index("idx_refresh_tokens_user").on(table.userId),
  ]
);

export type RefreshToken = typeof refreshTokens.$inferSelect;

/** Tamper-proof audit log of sensitive operations [FR-AUTH-3], [NFR-SEC-6]. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").default("").notNull(),
    summary: text("summary").default("").notNull(),
    ipAddress: text("ip_address").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_audit_logs_company_created").on(table.companyId, table.createdAt),
    index("idx_audit_logs_entity").on(table.entity, table.entityId),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
