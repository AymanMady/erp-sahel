/**
 * Catalogue des permissions et rôles par défaut (RBAC) — [FR-AUTH-2], [NFR-SEC-2].
 *
 * Source unique partagée : le serveur l'utilise pour semer `permissions`/`roles` et
 * garder chaque endpoint ; le client l'utilise pour masquer une entrée de menu ou une
 * action. **Masquer côté client n'est jamais une protection** : l'autorisation fait foi
 * côté serveur, le client ne fait que de l'ergonomie.
 */

/** Une permission = `<domaine>.<action>`. */
export const PERMISSIONS = {
  // Référentiels
  "parties.read": "Consulter les tiers",
  "parties.write": "Créer et modifier les tiers",
  "catalog.read": "Consulter le catalogue",
  "catalog.write": "Créer et modifier les produits",
  "services.read": "Consulter les prestations",
  "services.write": "Créer et modifier les prestations",
  // Opérations
  "inventory.read": "Consulter le stock",
  "inventory.write": "Mouvements et ajustements de stock",
  "purchasing.read": "Consulter les achats",
  "purchasing.write": "Créer commandes et réceptions",
  "sales.read": "Consulter devis et commandes",
  "sales.write": "Créer devis et commandes",
  "invoicing.read": "Consulter les factures",
  "invoicing.write": "Créer et valider les factures",
  "invoicing.cancel": "Annuler une facture et émettre un avoir",
  "payments.read": "Consulter les règlements",
  "payments.write": "Enregistrer les règlements",
  "banking.read": "Consulter la trésorerie",
  "banking.write": "Saisir et rapprocher les mouvements bancaires",
  "pos.use": "Utiliser la caisse",
  "pos.session.close": "Clôturer une session de caisse",
  // Comptabilité & pilotage
  "accounting.read": "Consulter la comptabilité",
  "accounting.write": "Saisir des écritures",
  "reports.read": "Consulter les rapports",
  // Administration
  "settings.read": "Consulter les paramètres",
  "settings.write": "Modifier les paramètres de la société",
  "users.read": "Consulter les utilisateurs",
  "users.write": "Gérer utilisateurs et rôles",
  "modules.manage": "Activer ou désactiver les modules",
  "audit.read": "Consulter le journal d'audit",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

const READ_ONLY: PermissionCode[] = ALL_PERMISSION_CODES.filter((code) => code.endsWith(".read"));

/** Rôles système proposés à la création d'une société ([§3 SRS] — acteurs). */
export const DEFAULT_ROLES: {
  slug: string;
  name: string;
  description: string;
  permissions: PermissionCode[] | "*";
}[] = [
  {
    slug: "administrateur",
    name: "Administrateur",
    description: "Paramétrage société, utilisateurs, référentiels et comptabilité.",
    permissions: "*",
  },
  {
    slug: "responsable-magasin",
    name: "Responsable magasin",
    description: "Achats, stock, catalogue et rapports du magasin.",
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
    name: "Vendeur / Caissier",
    description: "Ventes, devis, factures, encaissements et session de caisse.",
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
    name: "Comptable",
    description: "Journal, grand livre, balance et rapprochement bancaire.",
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
    name: "Consultation",
    description: "Accès en lecture seule à l'ensemble des écrans autorisés.",
    permissions: READ_ONLY,
  },
];

/** Développe `"*"` en liste complète. */
export function resolveRolePermissions(permissions: PermissionCode[] | "*"): PermissionCode[] {
  return permissions === "*" ? [...ALL_PERMISSION_CODES] : permissions;
}

/** Vrai si l'ensemble de permissions couvre **au moins une** des permissions requises. */
export function hasAnyPermission(
  granted: readonly string[],
  required: readonly PermissionCode[]
): boolean {
  if (required.length === 0) return true;
  return required.some((code) => granted.includes(code));
}

/** Vrai si l'ensemble de permissions couvre **toutes** les permissions requises. */
export function hasAllPermissions(
  granted: readonly string[],
  required: readonly PermissionCode[]
): boolean {
  return required.every((code) => granted.includes(code));
}
