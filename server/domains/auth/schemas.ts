/** Contrats de validation du domaine authentification. */

import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Identifiant requis").max(150),
  password: z.string().min(1, "Mot de passe requis").max(200),
  /** Société ciblée à la connexion (multi-société) ; sinon la société par défaut. */
  companyId: z.string().uuid().nullish(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
  companyId: z.string().uuid().nullish(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).nullish(),
});

export const switchCompanySchema = z.object({
  companyId: z.string().uuid(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8, "8 caractères minimum")
      .max(200)
      .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre")
      .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "La confirmation ne correspond pas",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
