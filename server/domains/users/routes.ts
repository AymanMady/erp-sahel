/**
 * Administration of users, roles and permissions.
 *
 * An administrator can only act **within their company**: creating a user links it
 * to that company, and assigning a role only applies to it ([BR-13]).
 * Creating platform super-administrators is not exposed here.
 */

import type { Express } from "express";
import { z } from "zod";

import { ALL_PERMISSION_CODES } from "@shared/rbac";
import { slugify } from "@shared/format";
import { runInTransaction } from "../../db";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { tr } from "../../shared/i18n";
import { hashPassword } from "../auth/application";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { usersRepository } from "./repository";

const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(200)
  .regex(/[A-Za-z]/, "The password must contain at least one letter")
  .regex(/[0-9]/, "The password must contain at least one digit");

const createUserSchema = z.object({
  username: z.string().min(3, "At least 3 characters").max(150),
  password: passwordSchema,
  email: z.string().email("Invalid email address").or(z.literal("")).default(""),
  firstName: z.string().max(100).default(""),
  lastName: z.string().max(100).default(""),
  phone: z.string().max(64).default(""),
  allowOfflineLogin: z.boolean().default(true),
  roleIds: z.array(z.string().uuid()).default([]),
});

const updateUserSchema = z.object({
  email: z.string().email().or(z.literal("")).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(64).optional(),
  allowOfflineLogin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  /** Reset by an administrator (without knowing the old password). */
  password: passwordSchema.optional(),
});

const roleSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(1000).default(""),
  permissions: z.array(z.enum(ALL_PERMISSION_CODES as [string, ...string[]])).default([]),
});

const idParamSchema = z.object({ id: z.string().uuid("Invalid identifier") });

const canRead = authorize({ anyPermission: ["users.read"] });
const canWrite = authorize({ anyPermission: ["users.write"] });

export function registerUsersRoutes(app: Express): void {
  app.get(
    "/api/users",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(await usersRepository.listForCompany(authOf(req).companyId));
    })
  );

  app.post(
    "/api/users",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const auth = authOf(req);
      const data = createUserSchema.parse(req.body);

      if (await usersRepository.findByUsername(data.username)) {
        throw new ConflictError("This username is already taken.");
      }

      const user = await runInTransaction(async (tx) => {
        const repository = usersRepository.withTransaction(tx);
        const created = await repository.insertUser({
          username: data.username.trim(),
          passwordHash: await hashPassword(data.password),
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          allowOfflineLogin: data.allowOfflineLogin,
        });
        await repository.addMembership(created.id, auth.companyId, true);
        await repository.setUserRoles(created.id, auth.companyId, data.roleIds);
        return created;
      });

      const { passwordHash: _hidden, ...publicUser } = user;
      res.status(201).json(publicUser);
    })
  );

  app.patch(
    "/api/users/:id",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const auth = authOf(req);
      const { id } = idParamSchema.parse(req.params);
      const data = updateUserSchema.parse(req.body);

      if (!(await usersRepository.isMember(id, auth.companyId))) {
        throw new NotFoundError("User not found in this company.");
      }
      if (id === auth.userId && data.isActive === false) {
        throw new BusinessRuleError("You cannot deactivate your own account.", "SELF_DEACTIVATION");
      }

      const { roleIds, password, ...patch } = data;
      const updated = await runInTransaction(async (tx) => {
        const repository = usersRepository.withTransaction(tx);
        const user = await repository.updateUser(id, {
          ...patch,
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        });
        if (!user) throw new NotFoundError("User not found.");
        if (roleIds) await repository.setUserRoles(id, auth.companyId, roleIds);
        return user;
      });

      const { passwordHash: _hidden, ...publicUser } = updated;
      res.json(publicUser);
    })
  );

  app.get(
    "/api/roles",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(await usersRepository.listRoles(authOf(req).companyId));
    })
  );

  app.post(
    "/api/roles",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const auth = authOf(req);
      const data = roleSchema.parse(req.body);
      const role = await runInTransaction(async (tx) => {
        const repository = usersRepository.withTransaction(tx);
        const created = await repository.insertRole({
          companyId: auth.companyId,
          name: data.name,
          slug: slugify(data.name),
          description: data.description,
          isSystem: false,
        });
        await repository.setRolePermissions(created.id, data.permissions);
        return created;
      });
      res.status(201).json(role);
    })
  );

  app.patch(
    "/api/roles/:id",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const auth = authOf(req);
      const { id } = idParamSchema.parse(req.params);
      const data = roleSchema.partial().parse(req.body);

      const role = await usersRepository.findRole(auth.companyId, id);
      if (!role) throw new NotFoundError("Role not found.");
      if (role.isSystem) {
        throw new BusinessRuleError(
          "A system role cannot be modified. Duplicate it to adapt it.",
          "SYSTEM_ROLE_READONLY"
        );
      }

      const updated = await runInTransaction(async (tx) => {
        const repository = usersRepository.withTransaction(tx);
        const next = await repository.updateRole(id, {
          ...(data.name ? { name: data.name, slug: slugify(data.name) } : {}),
          ...(data.description != null ? { description: data.description } : {}),
        });
        if (data.permissions) await repository.setRolePermissions(id, data.permissions);
        return next;
      });
      res.json(updated);
    })
  );

  app.delete(
    "/api/roles/:id",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const auth = authOf(req);
      const { id } = idParamSchema.parse(req.params);
      const role = await usersRepository.findRole(auth.companyId, id);
      if (!role) throw new NotFoundError("Role not found.");
      if (role.isSystem) {
        throw new BusinessRuleError("A system role cannot be deleted.");
      }
      const assignments = await usersRepository.countRoleAssignments(id);
      if (assignments > 0) {
        throw new BusinessRuleError(
          tr("This role is assigned to {count} user(s): remove it first.", { count: assignments }),
          "ROLE_IN_USE"
        );
      }
      await usersRepository.updateRole(id, { isActive: false });
      res.json({ success: true });
    })
  );

  app.get(
    "/api/permissions",
    requireAuth,
    canRead,
    asyncHandler(async (_req, res) => {
      res.json(await usersRepository.listPermissions());
    })
  );
}
