/**
 * Administration des utilisateurs, rôles et permissions.
 *
 * Un administrateur ne peut agir que **dans sa société** : créer un utilisateur le
 * rattache à cette société, et lui affecter un rôle ne vaut que pour elle ([BR-13]).
 * La création de super-administrateurs plateforme n'est pas exposée ici.
 */

import type { Express } from "express";
import { z } from "zod";

import { ALL_PERMISSION_CODES } from "@shared/rbac";
import { slugify } from "@shared/format";
import { runInTransaction } from "../../db";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { hashPassword } from "../auth/application";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { usersRepository } from "./repository";

const passwordSchema = z
  .string()
  .min(8, "8 caractères minimum")
  .max(200)
  .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre");

const createUserSchema = z.object({
  username: z.string().min(3, "3 caractères minimum").max(150),
  password: passwordSchema,
  email: z.string().email("Adresse e-mail invalide").or(z.literal("")).default(""),
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
  /** Réinitialisation par un administrateur (sans connaître l'ancien mot de passe). */
  password: passwordSchema.optional(),
});

const roleSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(100),
  description: z.string().max(1000).default(""),
  permissions: z.array(z.enum(ALL_PERMISSION_CODES as [string, ...string[]])).default([]),
});

const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

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
        throw new ConflictError("Cet identifiant est déjà utilisé.");
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
        throw new NotFoundError("Utilisateur introuvable dans cette société.");
      }
      if (id === auth.userId && data.isActive === false) {
        throw new BusinessRuleError(
          "Vous ne pouvez pas désactiver votre propre compte.",
          "SELF_DEACTIVATION"
        );
      }

      const { roleIds, password, ...patch } = data;
      const updated = await runInTransaction(async (tx) => {
        const repository = usersRepository.withTransaction(tx);
        const user = await repository.updateUser(id, {
          ...patch,
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        });
        if (!user) throw new NotFoundError("Utilisateur introuvable.");
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
      if (!role) throw new NotFoundError("Rôle introuvable.");
      if (role.isSystem) {
        throw new BusinessRuleError(
          "Un rôle système ne peut pas être modifié. Dupliquez-le pour l'adapter.",
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
      if (!role) throw new NotFoundError("Rôle introuvable.");
      if (role.isSystem) {
        throw new BusinessRuleError("Un rôle système ne peut pas être supprimé.");
      }
      const assignments = await usersRepository.countRoleAssignments(id);
      if (assignments > 0) {
        throw new BusinessRuleError(
          `Ce rôle est affecté à ${assignments} utilisateur(s) : retirez-le d'abord.`,
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
