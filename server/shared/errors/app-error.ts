/**
 * Application error hierarchy.
 *
 * Every error reaching the API is serialized by `errorHandler` into a stable envelope
 * `{ error, code, requestId?, details? }`: the client branches on `code`, never on the
 * message text. Messages are written in English and translated into the request
 * locale when serialized (see `server/shared/i18n`).
 */

import { tr } from "../i18n";

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
  constructor(message = "Invalid data", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

/** Screen or endpoint of a module that is not enabled for the current company ([BR-12]). */
export class ModuleDisabledError extends ForbiddenError {
  constructor(moduleName: string) {
    super(
      tr('The "{module}" module is not enabled for this company.', { module: tr(moduleName) }),
      "MODULE_DISABLED"
    );
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Data conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

/** Violated business rule (insufficient stock, locked document, unbalanced entry…). */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = "BUSINESS_RULE", details?: unknown) {
    super(message, 422, code, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable", code = "SERVICE_UNAVAILABLE") {
    super(message, 503, code);
  }
}

/** Turns PostgreSQL constraint violations into readable business errors. */
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
    return new ConflictError("Not possible: this item is referenced by other data.", {
      constraint,
      detail,
    });
  }
  if (code === "23502") {
    return new ValidationError("A required field is missing.", { detail });
  }
  return null;
}

const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  uq_products_company_sku: "A product with this SKU already exists.",
  uq_parties_company_code: "A party with this code already exists.",
  uq_services_company_code: "A service with this code already exists.",
  uq_warehouses_company_code: "A warehouse with this code already exists.",
  uq_accounts_company_code: "An account with this number already exists.",
  uq_journals_company_code: "A journal with this code already exists.",
  uq_bank_accounts_company_code: "A cash/bank account with this code already exists.",
  uq_pos_registers_company_code: "A register with this code already exists.",
  uq_users_username: "This username is already taken.",
  uq_companies_subdomain: "This subdomain is already taken.",
};

function uniqueConstraintMessage(constraint?: string): string {
  if (constraint && UNIQUE_CONSTRAINT_MESSAGES[constraint]) {
    return UNIQUE_CONSTRAINT_MESSAGES[constraint];
  }
  return "This value already exists.";
}
