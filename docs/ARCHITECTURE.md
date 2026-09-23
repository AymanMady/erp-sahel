# Architecture

Document de référence des règles de structure. Toute exception doit être justifiée ici,
pas décidée au cas par cas dans un fichier.

---

## 1. Vue d'ensemble

```
┌────────────────────────────────────────────────────────────────┐
│ client/  React 19 + Vite — PWA installable                     │
│   pages → features → entities (API) → shared (UI, offline)     │
└───────────────────────────┬────────────────────────────────────┘
                            │ HTTP JSON (JWT)
┌───────────────────────────▼────────────────────────────────────┐
│ server/  Express 5                                             │
│   routes → controller → service → application → repository     │
│   modules/  plugins métier, branchés au seul point de composition│
└───────────────────────────┬────────────────────────────────────┘
                            │ Drizzle ORM
┌───────────────────────────▼────────────────────────────────────┐
│ PostgreSQL — 70 tables, UUID en clé primaire, company_id partout│
└────────────────────────────────────────────────────────────────┘
```

`shared/` est compilé dans les deux bundles : schéma, calculs de prix, règles comptables,
normalisation OEM, contrat de synchronisation. **Une règle métier qui existe des deux côtés
n'est écrite qu'une fois.**

---

## 2. Serveur — contrat de couches

Chaque domaine vit dans `server/domains/<nom>/` et respecte la même découpe :

| Fichier          | Responsabilité                                                 | Interdits                    |
| ---------------- | -------------------------------------------------------------- | ---------------------------- |
| `routes.ts`      | Déclaration des routes et composition des gardes               | Aucune logique               |
| `controller.ts`  | Frontière HTTP : lire la requête, appeler le service, répondre | Règles métier, accès base    |
| `service.ts`     | Validation (Zod), normalisation d'erreurs, délégation          | Orchestration multi-domaines |
| `application.ts` | Cas d'usage, transactions, effets inter-domaines               | SQL direct                   |
| `repository.ts`  | Persistance uniquement, primitives de transaction              | Politique métier             |
| `schemas.ts`     | Contrats de validation                                         | —                            |
| `dto.ts`         | Types entre contrôleur et service                              | —                            |

### Règle de dépendance entre domaines

Un domaine appelle un autre domaine **par son `application` uniquement**. Importer le
`repository` d'un autre domaine est interdit : cela contournerait ses invariants.

### Propriété des données

- **`inventory` est seul propriétaire de l'état de stock.** Aucun autre domaine n'écrit
  `stock_items` ni `stock_movements` ; ventes, achats et POS passent par
  `inventoryApplication`.
- **`accounting` est seul propriétaire des écritures.** Les autres domaines fournissent des
  lignes exprimées en **clés logiques** (`SALES_REVENUE`, `VAT_COLLECTED`…), jamais des
  numéros de compte.
- **`numbering` est seul propriétaire des séquences légales.**

### Transactions

Un cas d'usage qui produit plusieurs effets les produit **dans une seule transaction**.
La validation d'une facture, par exemple, alloue le numéro, décrémente le stock et passe
l'écriture ensemble — ou rien.

Conséquence pratique : une fonction qui reçoit un `tx` doit le transmettre à **toutes** ses
lectures. Un tiers créé quelques lignes plus haut dans la même transaction n'est pas visible
depuis une autre connexion. C'est pourquoi `requireParty`, `invoicingApplication.get` et
leurs semblables acceptent un paramètre `database`.

Une seconde conséquence : `tx` est lié à **une** connexion PostgreSQL. Deux requêtes lancées
en `Promise.all` sur la même transaction se chevauchent et échouent. Dans une transaction,
les requêtes sont séquentielles.

---

## 3. Modules métier (plugins)

Le noyau ne connaît qu'un **contrat** (`server/domains/plugins/contract.ts`) :

```ts
interface ErpPlugin {
  meta: PluginMeta;                    // code, versions, dépendances
  permissions: PermissionCode[];       // RBAC contribué
  navigation: PluginNavItem[];         // entrées de menu
  searchCriteria: SearchCriterion[];   // filtres catalogue
  productProfile?: ProductProfileExtension;  // profil 1–1 du produit
  buildSnapshot?(db, companyId): Promise<Record<string, unknown>>;  // données hors ligne
  install?/enable?/disable?/seedDemo?  // cycle de vie
}
```

**La dépendance est strictement `module → noyau`.** Une règle ESLint
(`no-restricted-imports` sur `server/domains/**`) échoue au lint si le noyau importe un
module. Le seul fichier qui connaît les deux mondes est `server/modules/index.ts`.

Ajouter un domaine métier se fait sans toucher au noyau : voir
[`MODULES.md`](MODULES.md).

---

## 4. Client — Feature-Sliced Design

```
pages/      un écran par route ; compose des features et des widgets
widgets/    blocs autonomes de la coquille (barre latérale, en-tête)
features/   parcours composés (encaissement, éditeur de lignes de document)
entities/   accès API typé et modèles, par domaine
shared/     design system, offline, auth, utilitaires — sans logique métier
```

Le sens des dépendances descend : `pages → features → entities → shared`. Une couche
n'importe jamais une couche située au-dessus.

### Design system

Porté depuis **OrbynAdmin** (Tailwind v4 + shadcn/ui) : mêmes jetons de couleur, même
barre latérale rétractable, même personnalisateur de thème. Deux ajouts propres à l'ERP,
isolés dans `client/src/styles/erp.css` :

- jetons sémantiques de **statut de document** (brouillon, validé, partiel, payé, annulé) ;
- règles d'**impression** : la coquille disparaît, la feuille reste.

Les montants utilisent la classe `.tabular` : sans chiffres à largeur fixe, une colonne de
totaux ne s'aligne pas et devient pénible à contrôler.

---

## 5. Invariants du produit

Ces règles sont testées, pas seulement documentées.

| Invariant                                         | Où il est garanti                                                 | Test                       |
| ------------------------------------------------- | ----------------------------------------------------------------- | -------------------------- |
| Isolation multi-société                           | `company_id` sur toute table tenant ; `TenantRepository` l'impose | `isolation-rbac.test.ts`   |
| Une facture validée est inaltérable               | `is_locked`, refus dans `invoicingApplication.update`             | `business-flow.test.ts`    |
| Vente ⇒ stock décrémenté, avoir ⇒ stock réintégré | `inventoryApplication` dans la transaction du document            | `business-flow.test.ts`    |
| Écriture toujours équilibrée                      | `assertBalanced` avant insertion                                  | `accounting.test.ts`       |
| Synchronisation exactement une fois               | `client_uuid` unique + journal `sync_operations`                  | `sync-idempotence.test.ts` |
| Somme des lignes = total du document              | Reliquat d'arrondi reporté sur la dernière ligne                  | `pricing.test.ts`          |
| Équivalences OEM symétriques et transitives       | Parcours en largeur du graphe                                     | `oem.test.ts`              |
| Module désactivé ⇒ inaccessible                   | `requireModule` côté serveur                                      | `isolation-rbac.test.ts`   |

---

## 6. Sécurité

- **Authentification** : JWT court (15 min) + jeton de rafraîchissement opaque, dont seul
  le SHA-256 est stocké. Rotation à chaque usage, révocation effective.
- **Autorisation** : RBAC évalué **par société**. Le masquage côté client est un confort ;
  chaque endpoint porte sa garde.
- **Isolation** : `company_id` imposé par le repository, jamais lu depuis le corps de la
  requête.
- **Mots de passe** : bcrypt, coût 10. Message de connexion identique que le compte existe
  ou non, avec temps de réponse comparable.
- **Transport** : en-têtes de sécurité et CSP stricte en production ; limitation de débit
  agressive sur l'authentification, large sur la synchronisation.
- **Données hors ligne** : périmètre minimal, purge du cache à la déconnexion. Les
  empreintes de mot de passe ne descendent **que** sur la coquille desktop, où elles vivent
  dans un SQLite applicatif — jamais dans le stockage d'un navigateur.

---

## 7. Choix de représentation

**Montants** : entiers en centimes. **Taux** : points de base (16 % ⇒ `1600`).
**Quantités** : `numeric(14,3)`, transportées en chaîne, normalisées au calcul.

La raison est simple : `0.1 + 0.2 !== 0.3` en flottant, et une écriture comptable
déséquilibrée d'un centime est un incident. Voir `shared/money.ts`.

**Identifiants** : UUID partout. Un poste hors ligne doit pouvoir générer ses propres
identifiants sans risque de collision.
