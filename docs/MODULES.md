# Modules

ERP Sahel est **générique** : un seul catalogue, un seul stock, pour n'importe quel
commerce (pièces auto, vêtements, alimentation, quincaillerie, électronique…). Ce qui
distingue les articles (taille, couleur, référence constructeur…) passe par les
**variantes** du produit et leurs attributs libres, pas par un module spécialisé.

Pour garder l'interface simple, chaque **fonctionnalité** est un module qu'une société
active ou désactive selon ses besoins.

---

## 1. Les modules

| Code         | Libellé            | Routes fermées quand désactivé                                          | Dépend de   |
| ------------ | ------------------ | ----------------------------------------------------------------------- | ----------- |
| `pos`        | Caisse             | `/api/pos`                                                              | —           |
| `invoicing`  | Factures           | `/api/invoices`, `/api/credit-notes`                                    | —           |
| `sales`      | Devis et commandes | `/api/quotes`, `/api/sales-orders`                                      | `invoicing` |
| `purchasing` | Achats             | `/api/purchase-orders`, `/api/goods-receipts`, `/api/supplier-invoices` | `inventory` |
| `inventory`  | Stock              | `/api/inventory`                                                        | —           |
| `services`   | Prestations        | `/api/services` (lecture ouverte)                                       | —           |
| `banking`    | Caisse et banque   | `/api/banking` (lecture des comptes ouverte)                            | —           |
| `accounting` | Comptabilité       | `/api/accounting`                                                       | —           |
| `reports`    | Rapports           | `/api/reports`                                                          | —           |

**Toujours disponibles** : tableau de bord, produits et catégories, clients et
fournisseurs, magasins, paiements, paramètres, utilisateurs, synchronisation.

## 2. Niveaux (préréglages)

| Niveau        | Modules                                                      |
| ------------- | ------------------------------------------------------------ |
| Simple        | Caisse, Stock, Achats                                        |
| Avec factures | Simple + Factures, Devis et commandes, Prestations, Rapports |
| Complet       | Avec factures + Caisse et banque, Comptabilité               |

- Une **nouvelle société** démarre au niveau _Simple_ : le menu est court dès le premier jour.
- Une société **existante** sans choix enregistré garde tous ses modules actifs.
- La démonstration (`npm run db:seed`) active le niveau _Complet_.

## 3. Fonctionnement

- **Source unique** : `shared/modules-catalog.ts` (libellés, routes, dépendances,
  niveaux), lu par le serveur et par le client.
- **État par société** : table `company_plugins`. Sans ligne, un module est actif.
- **Registre** : `server/domains/plugins/registry.ts` — activation, désactivation
  (refusée si un module actif en dépend), application d'un niveau.
- **Garde API** : `featureGate` (`server/domains/plugins/features.ts`) répond 403 sur les
  routes d'un module désactivé. Les services internes, eux, continuent de s'appeler :
  une vente en caisse crée toujours sa facture. La synchronisation hors ligne n'est pas
  filtrée, pour qu'une vente saisie sans réseau ne soit jamais perdue.
- **Jeton** : les modules actifs sont portés par le jeton d'accès ; le client le
  réémet après chaque changement pour que le serveur voie le nouvel état tout de suite.
- **Interface** : le menu est filtré par module ; un écran d'un module désactivé
  affiche une invitation à l'activer (`ModuleGate`) ; le tableau de bord n'affiche que
  les actions rapides des modules actifs.
- **API** : `GET /api/platform/modules`, `POST /api/platform/modules/:code/enable|disable`,
  `POST /api/platform/modules/selection` avec `{ preset }` ou `{ modules }`.

Désactiver un module ne supprime **jamais** de données.

## 4. Ajouter un module

1. Ajouter son code à `MODULE_CODES` (`shared/schema/plugins.ts`).
2. Le décrire dans `FEATURE_MODULES` (`shared/modules-catalog.ts`) : nom, description,
   icône, dépendances, préfixes d'API.
3. Renseigner `module` sur ses entrées de menu (`client/src/shared/config/nav.ts`) et,
   si besoin, l'ajouter à un niveau.

## 5. Anciens modules métier

Les modules Pièces auto, Vêtements et Marché ont été retirés au profit d'un ERP
générique. Leurs tables (`ap_*`, `cl_*`, `mk_*`, `installed_plugins`) restent en base,
inutilisées, et la colonne `products.profile_type` vaut toujours `GENERIC`. Pour les
supprimer définitivement, générer une migration (`npm run db:generate`) après avoir
vérifié qu'aucune donnée n'est à conserver.
