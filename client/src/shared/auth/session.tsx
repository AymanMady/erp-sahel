/**
 * Contexte de session : utilisateur, société, permissions, modules actifs.
 *
 * Point clé pour l'usage terrain : au démarrage **hors ligne**, la session est
 * restaurée depuis le cache local plutôt que d'afficher un écran de connexion
 * inutilisable. Le serveur reste seul juge des autorisations — ce cache ne sert
 * qu'à composer l'interface ([FR-SYNC-1]).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { PermissionCode } from "@shared/rbac";
import { api } from "@/shared/api/http";
import { ApiError } from "@/shared/api/api-error";
import { clearOfflineStorage } from "@/shared/offline/db";
import {
  clearSession,
  getCachedSession,
  getRefreshToken,
  setAccessToken,
  setCachedSession,
  setRefreshToken,
  type CachedSession,
} from "./token-store";

export interface SessionUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface SessionCompany {
  id: string;
  name: string;
  currency: string;
  logo?: string | null;
  vatEnabled: boolean;
  defaultVatRateBp: number;
}

export interface SessionValue {
  status: "loading" | "authenticated" | "anonymous";
  user: SessionUser | null;
  company: SessionCompany | null;
  companies: { id: string; name: string; subdomain: string }[];
  permissions: string[];
  modules: string[];
  /** Vrai quand la session provient du cache local et n'a pas été revalidée. */
  isStale: boolean;
  can(permission: PermissionCode | PermissionCode[]): boolean;
  hasModule(code: string): boolean;
  login(input: { username: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  switchCompany(companyId: string): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

interface AuthResponse {
  user: SessionUser & { isSuperuser?: boolean };
  company: SessionCompany;
  permissions: string[];
  modules: string[];
  accessToken: string;
  refreshToken: string;
}

interface MeResponse {
  user: SessionUser;
  company: SessionCompany;
  companies: { id: string; name: string; subdomain: string }[];
  permissions: string[];
  modules: string[];
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: SessionValue["status"];
    user: SessionUser | null;
    company: SessionCompany | null;
    companies: { id: string; name: string; subdomain: string }[];
    permissions: string[];
    modules: string[];
    isStale: boolean;
  }>({
    status: "loading",
    user: null,
    company: null,
    companies: [],
    permissions: [],
    modules: [],
    isStale: false,
  });

  const applyCached = useCallback((cached: CachedSession) => {
    setState({
      status: "authenticated",
      user: cached.user,
      company: cached.company,
      companies: cached.companies,
      permissions: cached.permissions,
      modules: cached.modules,
      isStale: true,
    });
  }, []);

  const applyFresh = useCallback((me: MeResponse) => {
    setState({
      status: "authenticated",
      user: me.user,
      company: me.company,
      companies: me.companies,
      permissions: me.permissions,
      modules: me.modules,
      isStale: false,
    });
    setCachedSession({
      user: me.user,
      company: me.company,
      companies: me.companies,
      permissions: me.permissions,
      modules: me.modules,
    });
  }, []);

  const loadSession = useCallback(async () => {
    const cached = getCachedSession();
    if (cached) applyCached(cached);

    if (!getRefreshToken()) {
      if (!cached) setState((prev) => ({ ...prev, status: "anonymous" }));
      return;
    }

    try {
      const me = await api.get<MeResponse>("/api/auth/me");
      applyFresh(me);
    } catch (error) {
      // Hors ligne : on garde la session en cache, l'utilisateur continue à travailler.
      if (error instanceof ApiError && error.isNetworkError && cached) return;
      clearSession();
      setState({
        status: "anonymous",
        user: null,
        company: null,
        companies: [],
        permissions: [],
        modules: [],
        isStale: false,
      });
    }
  }, [applyCached, applyFresh]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      const session = await api.post<AuthResponse>("/api/auth/login", input);
      setAccessToken(session.accessToken);
      setRefreshToken(session.refreshToken);
      const me = await api.get<MeResponse>("/api/auth/me");
      applyFresh(me);
    },
    [applyFresh]
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      await api.post("/api/auth/logout", { refreshToken });
    } catch {
      // Une déconnexion hors ligne reste une déconnexion : on purge localement.
    }
    clearSession();
    await clearOfflineStorage();
    setState({
      status: "anonymous",
      user: null,
      company: null,
      companies: [],
      permissions: [],
      modules: [],
      isStale: false,
    });
  }, []);

  const switchCompany = useCallback(
    async (companyId: string) => {
      const session = await api.post<AuthResponse>("/api/auth/switch-company", { companyId });
      setAccessToken(session.accessToken);
      setRefreshToken(session.refreshToken);
      const me = await api.get<MeResponse>("/api/auth/me");
      applyFresh(me);
    },
    [applyFresh]
  );

  const value = useMemo<SessionValue>(() => {
    const permissionSet = new Set(state.permissions);
    return {
      ...state,
      can(permission) {
        const required = Array.isArray(permission) ? permission : [permission];
        return required.some((code) => permissionSet.has(code));
      },
      hasModule(code) {
        return state.modules.includes(code);
      },
      login,
      logout,
      switchCompany,
      refresh: loadSession,
    };
  }, [state, login, logout, switchCompany, loadSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession doit être utilisé à l'intérieur de <SessionProvider>.");
  }
  return context;
}

/** Raccourci ergonomique pour masquer une action non autorisée. */
export function useCan(): (permission: PermissionCode | PermissionCode[]) => boolean {
  return useSession().can;
}
