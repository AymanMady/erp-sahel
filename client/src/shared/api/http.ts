/**
 * Application HTTP client.
 *
 * Responsibilities: access token, **automatic refresh** on 401 (only once, with
 * de-duplication of concurrent calls), error normalization, reporting the network
 * state to the connectivity detector, and **offline mode**:
 *  - a read without network is served from the local cache (`http-cache.ts`);
 *  - a write without network is queued and replayed at synchronization
 *    (`offline-http.ts`), with an idempotency key that rules out any duplicate.
 */

import {
  getAccessToken,
  getDeviceId,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from "@/shared/auth/token-store";
import { apiUrl, devicePlatform } from "@/shared/desktop/desktop";
import { readCachedResponse, storeCachedResponse } from "@/shared/offline/http-cache";
import { isQueueableWrite, queueHttpWrite } from "@/shared/offline/offline-http";
import { currentLanguage, i18n } from "@/shared/i18n";
import { newUuid } from "@/shared/offline/outbox";
import { ApiError } from "./api-error";
import { reportNetworkResult } from "./network";

/**
 * Query parameters. Typed `object` rather than `Record<string, …>`: a declared
 * interface (e.g. `InvoiceFilters`) has no index signature and would not be
 * assignable to a `Record`. String conversion is done here.
 */
export type QueryParams = object;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** Does not add the token (login, refresh, health probe). */
  anonymous?: boolean;
  /** Does not try to refresh the session on 401 (avoids loops). */
  skipRefresh?: boolean;
  /** Idempotency key of a write; generated automatically when absent. */
  idempotencyKey?: string;
  /**
   * `false`: without network, the write fails instead of being queued. Used by the
   * replay itself, and by screens that have their own queue (`onlineOrQueued`).
   */
  queueOffline?: boolean;
}

/**
 * Delays beyond which the server is considered unreachable. Without them, a device
 * on a Wi-Fi whose Internet link is down would hang for long minutes on every
 * request, instead of switching to offline mode.
 */
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;

function buildUrl(path: string, query?: QueryParams): string {
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    // `null` and empty string mean "no filter": sending them would fail
    // the server-side `uuid().nullish()` validations.
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
        message: body.error || response.statusText || i18n.t("offline:api.requestFailed"),
        details: body.details,
        requestId: body.requestId,
      });
    } catch {
      // Unreadable body: fall back to the generic message below.
    }
  }
  return new ApiError({
    status: response.status,
    code: "UNKNOWN_ERROR",
    message: response.statusText || i18n.t("offline:api.requestFailed"),
  });
}

const GATEWAY_ERRORS = new Set([502, 503, 504]);

/**
 * De-duplicated refresh: if ten requests get a 401 at the same time, only one
 * asks for a new token and the nine others wait for the same result.
 */
let refreshInFlight: Promise<boolean> | null = null;

/*
 * Also exported for permission changes (module activation): the access token
 * carries the active modules, it must be reissued for the server to see them.
 */

export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(apiUrl("/api/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        // Revoked or expired token: the session is permanently closed.
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
      // Network down: keep the refresh token to try again later.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal, anonymous, skipRefresh } = options;

  const url = buildUrl(path, query);
  // Authenticated reads: kept so they can be shown again offline.
  const offlineReadable = method === "GET" && !anonymous;
  const isWrite = method !== "GET" && !anonymous;
  // Same key on first send and on replay: if the response got lost on the way, the
  // server recognizes the write instead of doing it again.
  const idempotencyKey = isWrite ? (options.idempotencyKey ?? newUuid()) : undefined;
  const offlineQueueable =
    isWrite && options.queueOffline !== false && isQueueableWrite(method, url);

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Device-Id": getDeviceId(),
      "X-Device-Platform": devicePlatform(),
    };
    // Server messages (errors, exports) come back in the UI language.
    headers["Accept-Language"] = currentLanguage();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    if (!anonymous) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort);
    const timer = setTimeout(abort, method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
    try {
      return await fetch(apiUrl(url), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };

  const offlineFallback = async (): Promise<{ value: T } | null> => {
    if (offlineReadable) {
      const cached = await readCachedResponse(url);
      if (cached !== undefined) return { value: cached as T };
    }
    if (offlineQueueable && idempotencyKey) {
      const queued = await queueHttpWrite(
        { method: method as "POST" | "PATCH" | "PUT" | "DELETE", url, body },
        idempotencyKey
      );
      return { value: queued as T };
    }
    return null;
  };

  let response: Response;
  try {
    response = await send();
    reportNetworkResult(true);
  } catch (error) {
    // Cancellation requested by the caller: not a network failure. (A timeout,
    // however, is one.)
    if (signal?.aborted) throw error;
    reportNetworkResult(false);
    const fallback = await offlineFallback();
    if (fallback) return fallback.value;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: i18n.t("offline:api.serverUnreachable"),
      isNetworkError: true,
    });
  }

  // Gateway reachable but server unavailable: same fallback as without network.
  if (GATEWAY_ERRORS.has(response.status)) {
    const fallback = await offlineFallback();
    if (fallback) return fallback.value;
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
  const data = (await response.json()) as T;
  if (offlineReadable) void storeCachedResponse(url, data);
  return data;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
