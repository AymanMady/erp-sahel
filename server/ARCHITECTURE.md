# Architecture serveur

Référence des règles de conception du backend. Les règles de domaine spécifiques sont
documentées dans le fichier du domaine concerné.

---

## 1. Structure

- **Point d'entrée** : `server/index.ts`
- **Composition des routes** : `server/routes.ts`
- **Domaines** : `server/domains/<nom>/`
- **Modules métier** : `server/modules/<code>/` — branchés au seul point de composition
- **Flux de requête** : `routes → controller → service → application → repository → base`

---

## 2. Contrat de couches

| Couche           | Autorisé                                               | Interdit                     |
| ---------------- | ------------------------------------------------------ | ---------------------------- |
| `routes.ts`      | Déclarer les routes, composer les gardes               | Toute logique                |
| `controller.ts`  | Lire la requête, appeler le service, écrire la réponse | Règle métier, accès base     |
| `service.ts`     | Valider (Zod), normaliser les erreurs, déléguer        | Orchestration multi-domaines |
| `application.ts` | Cas d'usage, transactions, effets inter-domaines       | SQL direct                   |
| `repository.ts`  | Requêtes et primitives de transaction                  | Politique métier             |

### Dépendances entre domaines

Un domaine appelle un autre domaine **par son `application`**. Importer le `repository`
d'un autre domaine est interdit : cela contournerait ses invariants.

### Propriété des données

| Domaine      | Détient exclusivement              |
| ------------ | ---------------------------------- |
| `inventory`  | `stock_items`, `stock_movements`   |
| `accounting` | `journal_entries`, `journal_lines` |
| `numbering`  | `document_sequences`               |
| `sync`       | `sync_operations`, `sync_devices`  |

Les autres domaines délèguent. Une facture ne décrémente pas le stock elle-même : elle
appelle `inventoryApplication.consumeForDocument`.

---

## 3. Transactions — trois règles

**1. Un cas d'usage, une transaction.** La validation d'une facture alloue le numéro,
décrémente le stock et passe l'écriture ensemble, ou rien.

**2. Le `tx` se propage aux lectures.** Une entité créée quelques lignes plus haut dans la
même transaction n'est pas visible depuis une autre connexion. C'est pourquoi
`partiesApplication.requireParty`, `invoicingApplication.get` et leurs semblables acceptent
un paramètre `database` — l'appelant doit passer son `tx`.

**3. Pas de `Promise.all` sur une transaction.** `tx` est lié à une seule connexion
PostgreSQL ; deux requêtes concurrentes se chevauchent et échouent. Dans une transaction,
les requêtes sont séquentielles. Le parallélisme reste possible sur le pool (`db`).

---

## 4. Persistance

`TenantRepository` (`server/shared/db/tenant-repository.ts`) fournit le CRUD filtré par
`company_id` pour les référentiels. Ce n'est pas un raccourci : l'isolation multi-société
est un invariant d'architecture, le centraliser garantit qu'aucun domaine ne peut l'oublier.
`companyId` est **imposé** par le repository, jamais lu depuis le corps de la requête.

Les domaines complexes — facturation, stock, comptabilité, caisse, synchronisation —
gardent un repository écrit à la main : leurs requêtes portent la valeur, pas le CRUD.

Les compteurs (`quantity`, `balance_cents`, `paid_amount_cents`) sont mis à jour **en
base** (`colonne + delta`), jamais par lecture-modification-écriture : deux opérations
simultanées resteraient sinon incohérentes.

---

## 5. Erreurs

Toutes les erreurs remontent en une enveloppe stable :

```json
{ "error": "message lisible", "code": "STABLE_CODE", "requestId": "…", "details": [] }
```

Le client branche sur `code`, jamais sur le texte. Un 500 ne divulgue pas le message
interne. Les violations de contraintes PostgreSQL sont traduites en messages métier
(`translateDatabaseError`).

Hiérarchie : `AppError` → `ValidationError` (400) · `UnauthorizedError` (401) ·
`ForbiddenError` / `ModuleDisabledError` (403) · `NotFoundError` (404) ·
`ConflictError` (409) · `BusinessRuleError` (422) · `ServiceUnavailableError` (503).

---

## 6. Gardes

Trois gardes composables, appliquées au niveau des routes :

```ts
app.post(
  "/api/invoices",
  requireAuth, // jeton valide → req.auth
  authorize({ anyPermission: ["invoicing.write"] }), // RBAC dans la société
  asyncHandler(controller.create)
);

app.get(
  "/api/modules/auto-parts/search",
  requireAuth,
  requireModule("auto_parts"), // module activé pour la société
  canRead,
  asyncHandler(handler)
);
```

Le masquage côté client est ergonomique ; **ces gardes sont la seule barrière qui compte**.

---

## 7. Modules

Le noyau ne connaît qu'un contrat (`domains/plugins/contract.ts`). La dépendance est
strictement `module → noyau`, vérifiée par ESLint. Le seul fichier qui connaît les deux
mondes est `server/modules/index.ts`.

Voir [`../docs/MODULES.md`](../docs/MODULES.md).

---

## 8. Synchronisation

Le moteur (`domains/sync/application.ts`) ne connaît pas les domaines : il connaît une
table `entité → handler`. Chaque handler **rejoue le cas d'usage en ligne**, jamais un
`INSERT` direct — c'est ce qui garantit qu'une facture hors ligne produit exactement les
mêmes effets qu'une facture saisie en ligne.

Une transaction **par opération**, pas par lot : un échec isolé ne fait pas perdre les
opérations déjà acquittées.

Voir [`../docs/SYNC_STRATEGY.md`](../docs/SYNC_STRATEGY.md).

---

## 9. Journalisation

`server/shared/logging/logger.ts` — JSON en production, lisible en développement. Les clés
sensibles (`password`, `token`, `authorization`, `secret`…) sont masquées avant écriture.
Chaque requête porte un `requestId`, renvoyé dans l'en-tête et dans les erreurs.
