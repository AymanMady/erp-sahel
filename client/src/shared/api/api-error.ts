import { i18n } from "@/shared/i18n";

/**
 * Typed representation of a non-2xx response.
 *
 * The server always returns `{ error, code, requestId?, details? }`
 * (`server/middleware/error-handler.ts`). The UI branches on `code`, never on the text:
 * a message may be reworded, a code is a contract.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  /** True when the request never completed (network down, server unreachable). */
  readonly isNetworkError: boolean;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    isNetworkError?: boolean;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.requestId = args.requestId;
    this.isNetworkError = args.isNetworkError ?? false;
  }

  /** Session expired or missing: the UI must redirect to the login page. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Insufficient rights or disabled module: stay on the page and show a message. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Validation error: the details feed the field messages. */
  get isValidation(): boolean {
    return this.code === "VALIDATION_ERROR";
  }
}

/** Displayable message for any error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return i18n.t("common:errors.serverUnreachable");
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return i18n.t("common:errors.unexpected");
}

/** Field errors from a serialized `ZodError`, for `react-hook-form`. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.isValidation) return {};
  const issues = error.details;
  if (!Array.isArray(issues)) return {};
  const result: Record<string, string> = {};
  for (const issue of issues) {
    if (issue && typeof issue === "object" && "path" in issue && "message" in issue) {
      const path = (issue as { path?: unknown[] }).path;
      const key = Array.isArray(path) ? path.join(".") : "";
      if (key) result[key] = String((issue as { message?: unknown }).message ?? "");
    }
  }
  return result;
}

/**
 * Item missing from the local data: displayable error, no further network attempt.
 * `message` must already be translated (use `i18n.t` at the call site).
 */
export function offlineNotFound(message: string): ApiError {
  return new ApiError({ status: 404, code: "OFFLINE_UNAVAILABLE", message });
}
