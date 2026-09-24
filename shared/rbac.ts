/**
 * Catalog of permissions and default roles (RBAC) — [FR-AUTH-2], [NFR-SEC-2].
 *
 * Single shared source: the server uses it to seed `permissions`/`roles` and to guard
 * every endpoint; the client uses it to hide a menu entry or an action. **Hiding on the
 * client is never a protection**: authorization is enforced by the server, the client
 * only handles ergonomics.
 *
 * Labels are the English source text; the client translates them by code. Role slugs
 * are stored identifiers and must not change.
 */

/** A permission = `<domain>.<action>`. */
export const PERMISSIONS = {
  // Master data
  "parties.read": "View parties",
  "parties.write": "Create and edit parties",
  "catalog.read": "View the catalog",
  "catalog.write": "Create and edit products",
  "services.read": "View services",
  "services.write": "Create and edit services",
  // Operations
  "inventory.read": "View stock",
  "inventory.write": "Stock movements and adjustments",
  "purchasing.read": "View purchasing",
  "purchasing.write": "Create orders and receipts",
  "sales.read": "View quotes and orders",
  "sales.write": "Create quotes and orders",
  "invoicing.read": "View invoices",
  "invoicing.write": "Create and validate invoices",
  "invoicing.cancel": "Cancel an invoice and issue a credit note",
  "payments.read": "View payments",
  "payments.write": "Record payments",
  "banking.read": "View cash and bank",
  "banking.write": "Enter and reconcile bank transactions",
  "pos.use": "Use the point of sale",
  "pos.session.close": "Close a POS session",
  // Accounting & reporting
  "accounting.read": "View accounting",
  "accounting.write": "Enter journal entries",
  "reports.read": "View reports",
  // Administration
  "settings.read": "View settings",
  "settings.write": "Edit company settings",
  "users.read": "View users",
  "users.write": "Manage users and roles",
  "modules.manage": "Enable or disable modules",
  "audit.read": "View the audit log",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

const READ_ONLY: PermissionCode[] = ALL_PERMISSION_CODES.filter((code) => code.endsWith(".read"));

/** System roles offered when a company is created ([§3 SRS] — actors). */
export const DEFAULT_ROLES: {
  slug: string;
  name: string;
  description: string;
  permissions: PermissionCode[] | "*";
}[] = [
  {
    slug: "administrateur",
    name: "Administrator",
    description: "Company settings, users, master data and accounting.",
    permissions: "*",
  },
  {
    slug: "responsable-magasin",
    name: "Store manager",
    description: "Store purchasing, stock, catalog and reports.",
    permissions: [
      "parties.read",
      "parties.write",
      "catalog.read",
      "catalog.write",
      "services.read",
      "services.write",
      "inventory.read",
      "inventory.write",
      "purchasing.read",
      "purchasing.write",
      "sales.read",
      "sales.write",
      "invoicing.read",
      "invoicing.write",
      "payments.read",
      "payments.write",
      "pos.use",
      "reports.read",
      "settings.read",
    ],
  },
  {
    slug: "vendeur",
    name: "Salesperson / Cashier",
    description: "Sales, quotes, invoices, collections and POS session.",
    permissions: [
      "parties.read",
      "parties.write",
      "catalog.read",
      "services.read",
      "inventory.read",
      "sales.read",
      "sales.write",
      "invoicing.read",
      "invoicing.write",
      "payments.read",
      "payments.write",
      "pos.use",
      "pos.session.close",
    ],
  },
  {
    slug: "comptable",
    name: "Accountant",
    description: "Journal, general ledger, trial balance and bank reconciliation.",
    permissions: [
      "parties.read",
      "catalog.read",
      "invoicing.read",
      "payments.read",
      "payments.write",
      "banking.read",
      "banking.write",
      "accounting.read",
      "accounting.write",
      "reports.read",
      "audit.read",
      "settings.read",
    ],
  },
  {
    slug: "consultation",
    name: "Read-only",
    description: "Read-only access to all authorized screens.",
    permissions: READ_ONLY,
  },
];

/** Expands `"*"` into the full list. */
export function resolveRolePermissions(permissions: PermissionCode[] | "*"): PermissionCode[] {
  return permissions === "*" ? [...ALL_PERMISSION_CODES] : permissions;
}

/** True if the granted permissions cover **at least one** of the required permissions. */
export function hasAnyPermission(
  granted: readonly string[],
  required: readonly PermissionCode[]
): boolean {
  if (required.length === 0) return true;
  return required.some((code) => granted.includes(code));
}

/** True if the granted permissions cover **all** the required permissions. */
export function hasAllPermissions(
  granted: readonly string[],
  required: readonly PermissionCode[]
): boolean {
  return required.every((code) => granted.includes(code));
}
