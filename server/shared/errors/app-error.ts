/**
 * Hiérarchie d'erreurs applicatives.
 *
 * Toute erreur remontée à l'API est sérialisée par `errorHandler` en une enveloppe
 * stable `{ error, code, requestId?, details? }` : le client branche sur `code`, jamais
 * sur le texte du message.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = "INTERNAL_ERROR",
    readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Données invalides", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentification requise") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Accès refusé", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

/** Écran ou endpoint d'un module non activé pour la société courante ([BR-12]). */
export class ModuleDisabledError extends ForbiddenError {
  constructor(moduleCode: string) {
    super(`Le module « ${moduleCode} » n'est pas activé pour cette société.`, "MODULE_DISABLED");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ressource introuvable") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflit de données", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

/** Règle métier violée (stock insuffisant, document verrouillé, écriture déséquilibrée…). */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = "BUSINESS_RULE", details?: unknown) {
    super(message, 422, code, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporairement indisponible", code = "SERVICE_UNAVAILABLE") {
    super(message, 503, code);
  }
}

/** Traduit les violations de contraintes PostgreSQL en erreurs métier lisibles. */
export function translateDatabaseError(error: unknown): AppError | null {
  if (!error || typeof error !== "object") return null;
  const { code, constraint, detail } = error as {
    code?: string;
    constraint?: string;
    detail?: string;
  };
  if (code === "23505") {
    return new ConflictError(uniqueConstraintMessage(constraint), { constraint, detail });
  }
  if (code === "23503") {
    return new ConflictError("Impossible : cet élément est référencé par d'autres données.", {
      constraint,
      detail,
    });
  }
  if (code === "23502") {
    return new ValidationError("Un champ obligatoire est manquant.", { detail });
  }
  return null;
}

const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  uq_products_company_sku: "Un produit avec cette référence existe déjà.",
  uq_parties_company_code: "Un tiers avec ce code existe déjà.",
  uq_services_company_code: "Une prestation avec ce code existe déjà.",
  uq_warehouses_company_code: "Un magasin avec ce code existe déjà.",
  uq_accounts_company_code: "Un compte comptable avec ce numéro existe déjà.",
  uq_journals_company_code: "Un journal avec ce code existe déjà.",
  uq_bank_accounts_company_code: "Un compte de trésorerie avec ce code existe déjà.",
  uq_pos_registers_company_code: "Une caisse avec ce code existe déjà.",
  uq_users_username: "Cet identifiant est déjà utilisé.",
  uq_companies_subdomain: "Ce sous-domaine est déjà pris.",
  uq_ap_manufacturers: "Ce fabricant existe déjà.",
  uq_ap_vehicle_brands: "Cette marque véhicule existe déjà.",
  uq_ap_oem_equivalences: "Cette équivalence est déjà déclarée.",
};

function uniqueConstraintMessage(constraint?: string): string {
  if (constraint && UNIQUE_CONSTRAINT_MESSAGES[constraint]) {
    return UNIQUE_CONSTRAINT_MESSAGES[constraint];
  }
  return "Cette valeur existe déjà.";
}
