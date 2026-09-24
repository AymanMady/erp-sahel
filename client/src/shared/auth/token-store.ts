/**
 * Session token storage.
 *
 * The access token stays **in memory**: it is short-lived (15 min) and must not
 * survive closing the tab. The refresh token, however, is persisted — this is
 * **what allows reopening the app offline** without an unusable login screen, then
 * getting a valid session back when the network returns.
 *
 * Storage silently falls back to memory if `localStorage` is unavailable (private
 * browsing, blocked storage): the app remains usable, just without session
 * persistence.
 */

const REFRESH_KEY = "erp.session.refresh";
const SESSION_KEY = "erp.session.cache";
const DEVICE_KEY = "erp.device.id";

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: continue in memory only.
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function onAccessTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRefreshToken(): string | null {
  return safeGet(REFRESH_KEY);
}

export function setRefreshToken(token: string | null): void {
  safeSet(REFRESH_KEY, token);
}

/**
 * Last known session (user, company, permissions, modules).
 * Used to display the app immediately when starting offline, before — or in the
 * absence of — any server response.
 */
export interface CachedSession {
  user: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
  };
  company: {
    id: string;
    name: string;
    currency: string;
    logo?: string | null;
    vatEnabled: boolean;
    defaultVatRateBp: number;
  };
  companies: { id: string; name: string; subdomain: string }[];
  permissions: string[];
  modules: string[];
  cachedAt: string;
}

export function getCachedSession(): CachedSession | null {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSession;
  } catch {
    return null;
  }
}

export function setCachedSession(session: Omit<CachedSession, "cachedAt"> | null): void {
  if (!session) {
    safeSet(SESSION_KEY, null);
    return;
  }
  safeSet(SESSION_KEY, JSON.stringify({ ...session, cachedAt: new Date().toISOString() }));
}

/** Stable device identifier — used to trace synchronization uploads. */
export function getDeviceId(): string {
  const existing = safeGet(DEVICE_KEY);
  if (existing) return existing;
  const generated =
    globalThis.crypto?.randomUUID?.() ?? `device-${Math.random().toString(36).slice(2, 12)}`;
  safeSet(DEVICE_KEY, generated);
  return generated;
}

/** Full purge on logout ([NFR-SEC-5]: no residual offline data). */
export function clearSession(): void {
  setAccessToken(null);
  safeSet(REFRESH_KEY, null);
  safeSet(SESSION_KEY, null);
}
