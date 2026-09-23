/**
 * Représentation typée d'une réponse non-2xx.
 *
 * Le serveur renvoie systématiquement `{ error, code, requestId?, details? }`
 * (`server/middleware/error-handler.ts`). L'UI branche sur `code`, jamais sur le texte :
 * un message peut être reformulé, un code est un contrat.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  /** Vrai quand la requête n'a pas abouti (réseau coupé, serveur injoignable). */
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

  /** Session expirée ou absente : l'UI doit renvoyer vers la connexion. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Droits insuffisants ou module désactivé : on reste sur place avec un message. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Erreur de validation : les détails alimentent les messages de champ. */
  get isValidation(): boolean {
    return this.code === "VALIDATION_ERROR";
  }
}

/** Message affichable pour une erreur quelconque. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return "Serveur injoignable. Vos saisies restent enregistrées localement.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Une erreur inattendue est survenue.";
}

/** Erreurs de champ issues d'un `ZodError` sérialisé, pour `react-hook-form`. */
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

/** Élément absent des données locales : erreur affichable, sans nouvel essai réseau. */
export function offlineNotFound(message: string): ApiError {
  return new ApiError({ status: 404, code: "OFFLINE_UNAVAILABLE", message });
}
