/**
 * Stockage des jetons de session.
 *
 * Le jeton d'accès reste **en mémoire** : il est court (15 min) et ne doit pas survivre
 * à la fermeture de l'onglet. Le jeton de rafraîchissement, lui, est persisté —
 * c'est **ce qui permet de rouvrir l'application hors ligne** sans écran de connexion
 * inutilisable, puis de retrouver une session valide au retour du réseau.
 *
 * Le stockage retombe silencieusement en mémoire si `localStorage` est indisponible
 * (navigation privée, stockage bloqué) : l'application reste utilisable, simplement
 * sans persistance de session.
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
    // Stockage indisponible : on continue en mémoire seule.
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
 * Dernière session connue (utilisateur, société, permissions, modules).
 * Sert à afficher l'application immédiatement au démarrage hors ligne, avant — ou
 * à défaut de — toute réponse du serveur.
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

/** Identifiant stable du poste — sert à tracer les remontées de synchronisation. */
export function getDeviceId(): string {
  const existing = safeGet(DEVICE_KEY);
  if (existing) return existing;
  const generated =
    globalThis.crypto?.randomUUID?.() ?? `poste-${Math.random().toString(36).slice(2, 12)}`;
  safeSet(DEVICE_KEY, generated);
  return generated;
}

/** Purge complète à la déconnexion ([NFR-SEC-5] : pas de données offline résiduelles). */
export function clearSession(): void {
  setAccessToken(null);
  safeSet(REFRESH_KEY, null);
  safeSet(SESSION_KEY, null);
}
