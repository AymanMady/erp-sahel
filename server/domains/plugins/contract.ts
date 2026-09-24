/**
 * Contrat de plugin ([FR-PLUG-1], `docs/PLUGIN_ARCHITECTURE.md`).
 *
 * Le noyau ne connaît **que** ce contrat : il n'importe jamais le code d'un module
 * ([BR-17]). Les modules sont branchés au seul point de composition
 * (`server/modules/index.ts`), exactement comme les routes le sont dans `routes.ts`.
 *
 * Points d'extension offerts :
 *  - `productProfile` : profil 1–1 du catalogue générique ([BR-11]) ;
 *  - `searchCriteria` : critères de recherche additionnels ([FR-SRCH-1]) ;
 *  - `navigation` / `permissions` : composition dynamique de l'UI et du RBAC ;
 *  - cycle de vie `install` / `enable` / `disable` / `seedDemo` ([FR-PLUG-6]).
 */

import type { SQL } from "drizzle-orm";

import type { PermissionCode } from "@shared/rbac";
import type { ModuleCode, ProfileType } from "@shared/schema";
import type { Database } from "../../db";

export interface PluginMeta {
  code: ModuleCode;
  /** `feature` : fonctionnalité du noyau masquable ; `business` : module métier. */
  kind: "feature" | "business";
  /**
   * État retenu tant que la société n'a jamais basculé ce module. Les fonctionnalités
   * sont actives par défaut : les sociétés existantes gardent tout leur périmètre.
   */
  defaultEnabled: boolean;
  name: string;
  description: string;
  /** Version du module (SemVer). */
  version: string;
  /** Plage de versions du noyau supportée ([FR-PLUG-8]). */
  coreVersion: string;
  /** Autres modules requis — vérifiés à l'activation ([BR-19]). */
  dependencies: ModuleCode[];
  /** Type de profil produit servi par ce module (modules métier seulement). */
  profileType?: ProfileType;
  /** Icône Tabler utilisée par la navigation du client. */
  icon: string;
}

/** Extension du catalogue : profil produit propre au domaine. */
export interface ProductProfileExtension {
  profileType: ProfileType;
  /** Charge les profils de plusieurs produits en une requête (évite le N+1). */
  load(database: Database, companyId: string, productIds: string[]): Promise<Map<string, unknown>>;
  /** Crée ou met à jour le profil attaché à un produit. */
  save(tx: Database, companyId: string, productId: string, payload: unknown): Promise<void>;
  /** Supprime le profil (produit archivé ou module désactivé). */
  remove?(tx: Database, companyId: string, productId: string): Promise<void>;
  /**
   * Restreint une recherche catalogue aux produits correspondant aux critères du
   * module. Retourne une condition portant sur `products.id`, ou `undefined` si la
   * requête ne concerne pas ce module.
   */
  buildSearchFilter?(companyId: string, query: Record<string, unknown>): SQL | undefined;
}

/** Critère de recherche exposé à l'UI pour composer dynamiquement les filtres. */
export interface SearchCriterion {
  /** Clé passée en paramètre de requête. */
  key: string;
  label: string;
  type: "text" | "select" | "number" | "boolean";
  /** Endpoint fournissant les options d'un `select`. */
  optionsEndpoint?: string;
}

/** Entrée de navigation contribuée par un module ([FR-PLAT-3]). */
export interface PluginNavItem {
  title: string;
  href: string;
  icon: string;
  /** Permission requise pour afficher l'entrée. */
  permission?: PermissionCode;
  items?: { title: string; href: string; permission?: PermissionCode }[];
}

export interface ErpPlugin {
  meta: PluginMeta;
  permissions: PermissionCode[];
  navigation: PluginNavItem[];
  searchCriteria: SearchCriterion[];
  productProfile?: ProductProfileExtension;
  /** Entités additionnelles acceptées par la synchronisation hors-ligne. */
  syncEntities?: string[];
  /**
   * Données du module embarquées dans l'instantané hors-ligne : sans elles, la
   * recherche par OEM ou par taille ne fonctionnerait plus une fois le réseau coupé.
   * Le volume doit rester borné — c'est un cache de poste, pas une réplication.
   */
  buildSnapshot?(database: Database, companyId: string): Promise<Record<string, unknown>>;

  /** Installation globale (référentiels partagés) — idempotente ([FR-PLUG-6]). */
  install?(tx: Database): Promise<void>;
  /** Activation pour une société — idempotente. */
  enable?(tx: Database, companyId: string): Promise<void>;
  /** Désactivation : ne supprime jamais de données métier, se contente de masquer. */
  disable?(tx: Database, companyId: string): Promise<void>;
  /** Jeu de démonstration propre au module. */
  seedDemo?(tx: Database, companyId: string): Promise<void>;
}
