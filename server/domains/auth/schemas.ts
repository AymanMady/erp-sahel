/** Validation contracts of the authentication domain. */

import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(150),
  password: z.string().min(1, "Password is required").max(200),
  /** Company targeted at login (multi-company); otherwise the default company. */
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
      .min(8, "At least 8 characters")
      .max(200)
      .regex(/[A-Za-z]/, "The password must contain at least one letter")
      .regex(/[0-9]/, "The password must contain at least one digit"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "The confirmation does not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
