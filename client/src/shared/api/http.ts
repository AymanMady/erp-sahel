/**
 * Client HTTP de l'application.
 *
 * Responsabilités : jeton d'accès, **rafraîchissement automatique** sur 401 (une seule
 * fois, avec dédoublonnage des appels concurrents), normalisation des erreurs, et
 * signalement de l'état réseau au détecteur de connectivité.
 */

import {
  getAccessToken,
  getDeviceId,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from "@/shared/auth/token-store";
import { devicePlatform } from "@/shared/desktop/desktop";
import { ApiError } from "./api-error";
import { reportNetworkResult } from "./network";

/**
 * Paramètres de requête. Typé `object` plutôt que `Record<string, …>` : une interface
 * déclarée (ex. `InvoiceFilters`) n'a pas de signature d'index et ne serait pas
 * assignable à un `Record`. La conversion en chaîne est faite ici.
 */
export type QueryParams = object;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** N'ajoute pas le jeton (connexion, rafraîchissement, sonde de santé). */
  anonymous?: boolean;
  /** Ne tente pas de rafraîchir la session sur 401 (évite les boucles). */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    // `null` et chaîne vide signifient « pas de filtre » : les transmettre
    // ferait échouer les validations `uuid().nullish()` côté serveur.
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
      continue;
    }
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        requestId?: string;
        details?: unknown;
      };
      return new ApiError({
        status: response.status,
        code: body.code || "UNKNOWN_ERROR",
        message: body.error || response.statusText || "La requête a échoué.",
        details: body.details,
        requestId: body.requestId,
      });
    } catch {
      // Corps illisible : on retombe sur le message générique ci-dessous.
    }
  }
  return new ApiError({
    status: response.status,
    code: "UNKNOWN_ERROR",
    message: response.statusText || "La requête a échoué.",
  });
}

/**
 * Rafraîchissement dédoublonné : si dix requêtes reçoivent 401 en même temps, une
 * seule demande un nouveau jeton et les neuf autres attendent le même résultat.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        // Jeton révoqué ou expiré : la session est définitivement close.
        setAccessToken(null);
        setRefreshToken(null);
        return false;
      }
      const session = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      setAccessToken(session.accessToken);
      setRefreshToken(session.refreshToken);
      return true;
    } catch {
      // Réseau coupé : on garde le jeton de rafraîchissement pour réessayer plus tard.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal, anonymous, skipRefresh } = options;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Device-Id": getDeviceId(),
      "X-Device-Platform": devicePlatform(),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!anonymous) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let response: Response;
  try {
    response = await send();
    reportNetworkResult(true);
  } catch (error) {
    // `AbortError` n'est pas une panne réseau : c'est une annulation volontaire.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    reportNetworkResult(false);
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Serveur injoignable.",
      isNetworkError: true,
    });
  }

  if (response.status === 401 && !anonymous && !skipRefresh) {
    if (await refreshSession()) {
      response = await send();
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return (await response.text()) as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
