/**
 * Utilisateurs, rôles, permissions (RBAC) et journal d'audit.
 *
 * Une permission est toujours évaluée **pour un utilisateur dans une société**
 * (`user_roles` porte `company_id`) : un comptable de la société A n'est rien dans
 * la société B ([FR-AUTH-2], [NFR-SEC-2]).
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
    /** Super-administrateur plateforme : court-circuite le RBAC (jamais créé par l'UI tenant). */
    isSuperuser: boolean("is_superuser").default(false).notNull(),
    /** Autorise la connexion hors-ligne du poste (le hash bcrypt part dans l'instantané POS). */
    allowOfflineLogin: boolean("allow_offline_login").default(true).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_users_username").on(table.username),
    index("idx_users_email").on(table.email),
  ]
);

export const insertUserSchema = createInsertSchema(users, {
  username: (s) => s.min(3, "3 caractères minimum"),
  email: (s) => s.email("Adresse e-mail invalide").or(z.literal("")),
}).omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
/** Utilisateur exposé par l'API : jamais de `passwordHash`. */
export type PublicUser = Omit<User, "passwordHash">;

export const permissions = pgTable(
  "permissions",
  {
    ...baseColumns,
    /** Code `module.action` (ex. `invoicing.write`). */
    code: text("code").notNull(),
    label: text("label").default("").notNull(),
    /** Module propriétaire — un plugin déclare ses permissions [FR-PLUG-1]. */
    moduleCode: text("module_code").default("core").notNull(),
  },
  (table) => [uniqueIndex("uq_permissions_code").on(table.code)]
);

export type Permission = typeof permissions.$inferSelect;

export const roles = pgTable(
  "roles",
  {
    ...baseColumns,
    /** `null` = rôle système partagé par toutes les sociétés (Administrateur, Vendeur…). */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").default("").notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("uq_roles_company_slug").on(table.companyId, table.slug),
    // PostgreSQL considère deux NULL comme distincts : sans cet index partiel, les
    // rôles système (`company_id IS NULL`) pourraient être dupliqués à chaque
    // réexécution de l'amorçage.
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

/** Rattachement d'un utilisateur à une société (membership). */
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

/** Affectation d'un rôle dans le périmètre d'une société. */
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

/** Rattachement utilisateur ↔ magasin autorisé [FR-AUTH-4]. */
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
 * Jetons de rafraîchissement : rotation et révocation [NFR-SEC-1].
 * Seul le SHA-256 du jeton est stocké — une fuite de base ne permet pas de rejouer une session.
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

/** Journal d'audit inaltérable des opérations sensibles [FR-AUTH-3], [NFR-SEC-6]. */
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
