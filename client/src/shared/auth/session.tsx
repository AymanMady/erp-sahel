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
  useRef,
  useState,
  type ReactNode,
} from "react";

import { toast } from "sonner";

import type { PermissionCode } from "@shared/rbac";
import { api } from "@/shared/api/http";
import { ApiError } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { clearOfflineStorage } from "@/shared/offline/db";
import { stopLocalSession } from "@/shared/offline/local/local-sync";
import { forgetOfflineReadiness } from "@/shared/offline/offline-prefetch";
import { readSnapshot } from "@/shared/offline/snapshot";
import {
  clearSession,
  getCachedSession,
  getRefreshToken,
  onSessionRevoked,
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
  /**
   * Set by the server when an administrator created the account or reset its password:
   * the person must choose their own password before using the application.
   */
  mustChangePassword?: boolean;
  /** The platform super-administrator: the only one to see the technical screens. */
  isSuperuser?: boolean;
}

export interface SessionCompany {
  id: string;
  name: string;
  currency: string;
  logo?: string | null;
}

export interface SessionValue {
  status: "loading" | "authenticated" | "anonymous";
  user: SessionUser | null;
  company: SessionCompany | null;
  permissions: string[];
  modules: string[];
  /** True when the session comes from the local cache and has not been revalidated. */
  isStale: boolean;
  /** The platform super-administrator (technical screens). */
  isSuperuser: boolean;
  can(permission: PermissionCode | PermissionCode[]): boolean;
  hasModule(code: string): boolean;
  login(input: { username: string; password: string }): Promise<void>;
  /**
   * Opens the till without network, for an account whose password the desktop shell
   * has just checked against the synchronized copy. No API token: the server asks for a
   * real sign-in once the network is back. False if the copy does not know the account.
   */
  unlockOffline(username: string): Promise<boolean>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const ANONYMOUS = {
  status: "anonymous" as const,
  user: null,
  company: null,
  permissions: [],
  modules: [],
  isStale: false,
};

interface AuthResponse {
  user: SessionUser;
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
      // Only a refusal of the server closes the session. Offline, a server without its
      // database, a server busy or restarting: the user keeps working on this device.
      const refused = error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (!refused && cached) return;
      if (refused) clearSession();
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

  // The server refused the session (password changed, account disabled, sign-in
  // expired): back to the sign-in screen, once, instead of failing every request.
  // Data waiting to be sent stays on the device.
  const statusRef = useRef(state.status);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);
  useEffect(
    () =>
      onSessionRevoked(() => {
        if (statusRef.current !== "authenticated") return;
        statusRef.current = "anonymous";
        clearSession();
        setState(ANONYMOUS);
        toast.info(i18n.t("auth:sessionEnded"));
      }),
    []
  );

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

  const unlockOffline = useCallback(
    async (username: string) => {
      const snapshot = await readSnapshot();
      const wanted = username.trim().toLowerCase();
      const account = snapshot?.offlineAuthUsers?.find(
        (user) => user.username.toLowerCase() === wanted
      );
      if (!snapshot?.company || !account) return false;
      const session = {
        user: {
          id: account.id,
          username: account.username,
          firstName: account.firstName,
          lastName: account.lastName,
          isSuperuser: false,
        },
        company: {
          id: snapshot.company.id,
          name: snapshot.company.name,
          currency: snapshot.company.currency,
          logo: snapshot.company.logo,
        },
        // Accounts offered offline all work at the till; older copies carry no rights.
        permissions: account.permissions ?? ["pos.use"],
        modules: snapshot.modules.map((module) => module.code),
      };
      setCachedSession(session);
      applyCached({ ...session, cachedAt: new Date().toISOString() });
      return true;
    },
    [applyCached]
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
    forgetOfflineReadiness();
    // The local database stays on disk — unsent changes included — but closed.
    await stopLocalSession().catch(() => undefined);
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
      isSuperuser: Boolean(state.user?.isSuperuser),
      can(permission) {
        const required = Array.isArray(permission) ? permission : [permission];
        return required.some((code) => permissionSet.has(code));
      },
      hasModule(code) {
        return state.modules.includes(code);
      },
      login,
      unlockOffline,
      logout,
      refresh: loadSession,
    };
  }, [state, login, unlockOffline, logout, loadSession]);

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
