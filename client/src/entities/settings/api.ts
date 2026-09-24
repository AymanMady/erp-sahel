/** Accès API du paramétrage (société, utilisateurs, rôles, modules, prestations). */

import { api, apiRequest } from "@/shared/api/http";
import { listServicesOffline, withOfflineFallback } from "@/shared/offline/offline-reads";
import type {
  Company,
  ModuleDescriptor,
  Paginated,
  RoleWithPermissions,
  Service,
  UserWithRoles,
} from "@/entities/types";

export const settingsApi = {
  getCompany: () => api.get<Company>("/api/company"),
  updateCompany: (body: unknown) => api.patch<Company>("/api/company", body),
  listSettings: () => api.get<{ key: string; value: string }[]>("/api/company/settings"),
  setSetting: (key: string, value: string) => api.put("/api/company/settings", { key, value }),
  listSequences: () =>
    api.get<{ documentType: string; year: number; lastNumber: number; prefix: string }[]>(
      "/api/company/sequences"
    ),

  listModules: () => api.get<{ modules: ModuleDescriptor[] }>("/api/platform/modules"),
  enableModule: (code: string) =>
    api.post<{ success: true; modules: ModuleDescriptor[] }>(
      `/api/platform/modules/${code}/enable`
    ),
  disableModule: (code: string) =>
    api.post<{ success: true; modules: ModuleDescriptor[] }>(
      `/api/platform/modules/${code}/disable`
    ),
  /** Niveau (préréglage) : exige le réseau, car il bascule plusieurs modules à la fois. */
  applyModuleSelection: (body: { preset: string } | { modules: string[] }) =>
    apiRequest<{ success: true; modules: ModuleDescriptor[] }>("/api/platform/modules/selection", {
      method: "POST",
      body,
      queueOffline: false,
    }),

  listUsers: () => api.get<UserWithRoles[]>("/api/users"),
  createUser: (body: unknown) => api.post<UserWithRoles>("/api/users", body),
  updateUser: (id: string, body: unknown) => api.patch<UserWithRoles>(`/api/users/${id}`, body),

  listRoles: () => api.get<RoleWithPermissions[]>("/api/roles"),
  createRole: (body: unknown) => api.post<RoleWithPermissions>("/api/roles", body),
  updateRole: (id: string, body: unknown) =>
    api.patch<RoleWithPermissions>(`/api/roles/${id}`, body),
  deleteRole: (id: string) => api.delete(`/api/roles/${id}`),
  listPermissions: () =>
    api.get<{ id: string; code: string; label: string; moduleCode: string }[]>("/api/permissions"),

  listServices: (filters: { search?: string; limit?: number; offset?: number } = {}) =>
    withOfflineFallback(
      () => api.get<Paginated<Service>>("/api/services", filters),
      (snapshot) => listServicesOffline(snapshot, filters)
    ),
  createService: (body: unknown) => api.post<Service>("/api/services", body),
  updateService: (id: string, body: unknown) => api.patch<Service>(`/api/services/${id}`, body),
  archiveService: (id: string) => api.delete(`/api/services/${id}`),

  changePassword: (body: unknown) => api.post("/api/auth/change-password", body),
};
