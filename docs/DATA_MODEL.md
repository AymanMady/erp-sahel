# Modèle de données

70 tables PostgreSQL. Source de vérité : `shared/schema/` — ce document en explique les
intentions, il ne le duplique pas.

---

## Conventions

| Convention                                               | Raison                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **UUID en clé primaire** partout                         | Un poste hors ligne génère ses propres identifiants sans risque de collision |
| **`company_id` sur toute table tenant-scoped**           | L'isolation est une colonne, pas une convention d'usage                      |
| **Montants en `integer` (centimes)**                     | Aucun flottant ne touche une somme d'argent                                  |
| **Taux en `integer` (points de base)**                   | 16 % ⇒ `1600` ; exact, comparable, sans arrondi                              |
| **Quantités en `numeric(14,3)`**                         | Précision au gramme/millilitre, transportées en chaîne                       |
| **`created_at` / `updated_at`** partout                  | Base du delta de synchronisation                                             |
| **`is_active` (soft-delete)** sur les référentiels       | Un produit archivé reste lisible sur les anciennes factures                  |
| **`client_uuid` unique** sur les entités synchronisables | Clé d'idempotence hors ligne                                                 |

Les documents comptables ne sont **jamais** supprimés physiquement.

---

## Domaines

### Société et accès

`companies` · `company_settings` · `users` · `permissions` · `roles` ·
`role_permissions` · `user_companies` · `user_roles` · `user_warehouses` ·
`refresh_tokens` · `audit_logs`

Une permission est évaluée **pour un utilisateur dans une société** : `user_roles` porte
`company_id`. Un comptable de la société A n'est rien dans la société B.

Les rôles système (`company_id IS NULL`) sont partagés ; un index unique partiel empêche
leur duplication à chaque amorçage.

### Modules

`company_plugins` (activation par société ; sans ligne, le module est actif)

### Catalogue

`categories` · `products` · `product_variants` · `attribute_definitions` ·
`product_suppliers`

`products` est **générique** : il sert tout type de commerce. Ce qui distingue les
articles (taille, couleur, conditionnement…) passe par les variantes et leurs attributs.

### Tiers

`parties` · `contacts` · `party_addresses`

Un tiers peut être client **et** fournisseur (`party_type = 'BOTH'`) sans duplication.

### Stock

`warehouses` · `stock_locations` · `stock_items` · `stock_movements` ·
`inventory_counts` · `inventory_count_lines`

`stock_items.quantity` est **dérivé** : il est recalculé dans la même transaction que
l'insertion du mouvement, jamais écrit à l'aveugle. `stock_movements` porte `direction`
(`IN`/`OUT`) séparé du type : sans cette colonne, un ajustement d'inventaire — qui peut
aller dans les deux sens — exigerait des quantités négatives, et le cumul des mouvements
cesserait d'être lisible.

### Achats

`purchase_orders` · `purchase_order_lines` · `goods_receipts` · `goods_receipt_lines` ·
`supplier_invoices` · `supplier_invoice_lines`

La réception et la facture sont **distinctes** : la marchandise peut arriver avant sa
facture, et inversement.

### Ventes et facturation

`quotes` · `quote_lines` · `sales_orders` · `sales_order_lines` · `sales_invoices` ·
`sales_invoice_lines` · `credit_notes` · `credit_note_lines`

Les quatre types de lignes partagent les mêmes colonnes (`documentLineColumns`) : une
remise se calcule donc identiquement sur un devis et sur la facture qui en découle.

Un **ticket de caisse est une facture** (`source = 'POS'`) : la chaîne stock → comptabilité
est strictement la même qu'en back-office, ce qui évite un second circuit comptable.

### Règlements et trésorerie

`payments` · `bank_accounts` · `bank_transactions`

Un règlement confirmé produit trois effets indissociables : imputation sur la facture,
mouvement de trésorerie, écriture comptable.

### Caisse

`pos_registers` · `pos_sessions`

Une caisse n'accepte qu'une session ouverte à la fois. La clôture recalcule l'attendu
(fond + encaissements espèces) et expose l'écart.

### Comptabilité

`accounts` · `account_mappings` · `journals` · `journal_entries` · `journal_lines` ·
`fiscal_years`

`account_mappings` est la clé de l'interchangeabilité du référentiel : les automatismes
désignent une **clé logique** (`SALES_REVENUE`, `VAT_COLLECTED`…), et cette table dit quel
compte la sert. Passer d'OHADA à PCG revient à fournir un autre plan et d'autres
associations — le moteur d'écritures ne change pas.

### Numérotation

`document_sequences` — une séquence par société, par type de document et par exercice.
L'allocation se fait par `INSERT … ON CONFLICT DO UPDATE … RETURNING`, dans la transaction
du document.

### Synchronisation

`sync_operations` (journal d'ingestion, unique sur `client_uuid`) · `sync_devices`
(supervision des postes)

### Tables historiques

Les tables des anciens modules métier (`ap_*`, `cl_*`, `mk_*`, `installed_plugins`)
restent en base mais ne sont plus utilisées ; voir [`MODULES.md`](MODULES.md) §5.

---

## Règles métier portées par le schéma

| Règle                               | Mise en œuvre                                                     |
| ----------------------------------- | ----------------------------------------------------------------- |
| Stock indexé par article et axes    | Unicité `(company, product, warehouse, lot)`                      |
| Facture validée inaltérable         | `is_locked` + refus applicatif                                    |
| Écriture équilibrée                 | `total_debit_cents = total_credit_cents`, vérifié avant insertion |
| Synchronisation exactement une fois | Index unique sur `client_uuid`, sur chaque entité                 |
| Isolation multi-société             | `company_id` + filtrage systématique par `TenantRepository`       |

---

## Migrations

En développement : `npm run db:push` (comparaison de schéma).
En production : `npm run db:generate` puis `npm run db:migrate` — les migrations
versionnées sont revues avant d'être jouées, `push` ne l'est pas.
