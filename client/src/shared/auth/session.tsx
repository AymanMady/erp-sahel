/**
 * Session context: user, company, permissions, active modules.
 *
 * Key point for field use: when starting **offline**, the session is restored
 * from the local cache instead of showing an unusable login screen. The server
 * remains the sole judge of authorizations — this cache is only used to build
 * the interface ([FR-SYNC-1]).
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
  permissions: string[];
  modules: string[];
  /** True when the session comes from the local cache and has not been revalidated. */
  isStale: boolean;
  can(permission: PermissionCode | PermissionCode[]): boolean;
  hasModule(code: string): boolean;
  login(input: { username: string; password: string }): Promise<void>;
  logout(): Promise<void>;
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
  permissions: string[];
  modules: string[];
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: SessionValue["status"];
    user: SessionUser | null;
    company: SessionCompany | null;
      permissions: string[];
    modules: string[];
    isStale: boolean;
  }>({
    status: "loading",
    user: null,
    company: null,
    permissions: [],
    modules: [],
    isStale: false,
  });

  const applyCached = useCallback((cached: CachedSession) => {
    setState({
      status: "authenticated",
      user: cached.user,
      company: cached.company,
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
      permissions: me.permissions,
      modules: me.modules,
      isStale: false,
    });
    setCachedSession({
      user: me.user,
      company: me.company,
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
      // Offline: keep the cached session, the user keeps working.
      if (error instanceof ApiError && error.isNetworkError && cached) return;
      clearSession();
      setState({
        status: "anonymous",
        user: null,
        company: null,
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
      // An offline logout is still a logout: purge locally.
    }
    clearSession();
    await clearOfflineStorage();
    setState({
      status: "anonymous",
      user: null,
      company: null,
        permissions: [],
      modules: [],
      isStale: false,
    });
  }, []);

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
      refresh: loadSession,
    };
  }, [state, login, logout, loadSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return context;
}

/** Convenience shortcut to hide an unauthorized action. */
export function useCan(): (permission: PermissionCode | PermissionCode[]) => boolean {
  return useSession().can;
}
