# ERP Sahel

ERP **générique et simple**, multi-société, **fonctionnel hors ligne** : caisse, stock,
achats, ventes, factures et comptabilité OHADA, pour **tout type de commerce** (pièces
auto, vêtements, alimentation, quincaillerie…).

Chaque fonctionnalité est un **module activable** : une boutique qui n'utilise que la
caisse et le stock n'a qu'un menu de quelques lignes.

---

## Ce que fait le produit

| Domaine            | Couverture                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Tiers**          | Clients, fournisseurs, prospects, rôle mixte, contacts, adresses, encours, historique   |
| **Catalogue**      | Produits génériques, variantes, catégories, code-barres, prix, fournisseurs référencés  |
| **Stock**          | Multi-magasin, lots, mouvements tracés, coût moyen pondéré, transferts, seuils d'alerte |
| **Achats**         | Commande fournisseur → réception (entrée en stock) → facture fournisseur                |
| **Ventes**         | Devis → commande → facture, avoirs, remises ligne et globale, TVA multi-taux            |
| **Caisse (POS)**   | Écran plein cadre, scanner, sessions avec fond de caisse et contrôle d'écart            |
| **Règlements**     | Encaissements/décaissements multi-modes, imputation sur facture, trésorerie             |
| **Comptabilité**   | Plan OHADA configurable, journal, grand livre, balance, exercices                       |
| **Pilotage**       | Tableau de bord, rapports ventes/stock/achats                                           |
| **Administration** | Multi-société, utilisateurs, rôles et permissions granulaires, audit, modules           |
| **Hors ligne**     | PWA installable + coquille desktop, file d'attente, synchronisation idempotente         |

### Modules activables

Caisse, Factures, Devis et commandes, Achats, Stock, Prestations, Caisse et banque,
Comptabilité, Rapports. Trois niveaux prêts à l'emploi : **Simple** (caisse, stock,
achats), **Avec factures** et **Complet**. Voir [`docs/MODULES.md`](docs/MODULES.md).

---

## Le mode hors ligne

C'est l'exigence structurante du produit : **une vente ne s'arrête jamais parce que le
réseau est tombé**.

```
Poste de vente                                    Serveur
┌──────────────────────────────┐                 ┌─────────────────────────┐
│ Service Worker → coquille    │                 │ POST /api/sync/push     │
│ IndexedDB / SQLite :         │  ──────────────▶│  · idempotent par       │
│  · instantané de lecture     │                 │    client_uuid          │
│  · OUTBOX (ventes en attente)│◀────────────────│  · rejoue les mêmes     │
│ Moteur de synchronisation    │  GET /sync/pull │    cas d'usage métier   │
└──────────────────────────────┘                 └─────────────────────────┘
```

1. L'application démarre **sans réseau** : le Service Worker sert la coquille, l'instantané
   local alimente la recherche produit (nom, référence, code-barres) et client.
2. Les ventes créées hors ligne reçoivent un **numéro provisoire** (`OFFLINE-TKT-0001`) et
   partent dans une file d'attente locale, qui **survit à la fermeture du navigateur**.
3. Au retour du réseau, la file est rejouée dans l'**ordre causal**. Le serveur attribue le
   numéro légal définitif, décrémente le stock et passe l'écriture comptable.
4. Rejouer le même lot ne crée **aucun doublon** : l'unicité de `client_uuid` en base le
   garantit, et la réponse renvoie l'identifiant déjà créé.

Détail complet : [`docs/SYNC_STRATEGY.md`](docs/SYNC_STRATEGY.md).

---

## Démarrage rapide

### Prérequis

- **Node.js 20.11+**
- **PostgreSQL 14+** (ou Docker, pour la base fournie)

### Installation

```bash
git clone <dépôt> erp-sahel && cd erp-sahel
npm install

cp .env.example .env          # puis renseignez DATABASE_URL et JWT_SECRET

docker compose up -d db       # base PostgreSQL locale (port 5436)

npm run db:push               # crée le schéma
npm run db:seed               # société, compte admin, jeu de démonstration

npm run dev                   # http://localhost:5000
```

Identifiants de démonstration : **`admin` / `Admin123!`** (modifiables dans `.env`).

### Commandes

| Commande                             | Rôle                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| `npm run dev`                        | Serveur + client avec rechargement à chaud, sur un seul port |
| `npm run build`                      | Build de production (`dist/public` + `dist/index.cjs`)       |
| `npm start`                          | Démarre le build de production                               |
| `npm run check`                      | Vérification TypeScript de tout le dépôt                     |
| `npm run lint`                       | ESLint, règles d'architecture comprises                      |
| `npm test`                           | 80 tests unitaires et d'intégration                          |
| `npm run test:e2e`                   | Scénario end-to-end, coupure réseau incluse                  |
| `npm run quality`                    | `check` + `lint` + `test`                                    |
| `npm run db:push`                    | Synchronise le schéma (développement)                        |
| `npm run db:generate` / `db:migrate` | Migrations versionnées (production)                          |
| `npm run db:seed`                    | Amorçage ; `-- --core-only` pour omettre la démonstration    |
| `npm run db:reset`                   | Réinitialise la base (développement uniquement)              |
| `npm run tauri:build`                | Construit l'application desktop                              |

---

## Architecture

```
erp-sahel/
├── client/               Application React (Vite) — PWA installable
│   ├── public/           Service Worker, manifeste, icônes
│   └── src/
│       ├── app/          Providers et routage
│       ├── pages/        Un écran par route
│       ├── widgets/      Coquille applicative (barre latérale, en-tête)
│       ├── features/     Parcours composés (caisse, documents)
│       ├── entities/     Accès API typé par domaine
│       └── shared/       Design system, offline, auth, utilitaires
├── server/               API Express
│   ├── domains/<nom>/    routes → controller → service → application → repository
│   ├── middleware/       Sécurité, limitation de débit, erreurs
│   └── shared/           Erreurs, journalisation, primitives de persistance
├── shared/               Code partagé client ⇄ serveur
│   ├── schema/           Schéma Drizzle (source de vérité du modèle)
│   ├── pricing.ts        Calcul des totaux — la même fonction des deux côtés
│   ├── accounting-rules.ts  Plans comptables et écritures automatiques
│   ├── modules-catalog.ts  Modules activables et niveaux
│   └── sync-protocol.ts  Contrat de synchronisation
├── src-tauri/            Coquille desktop (Rust) : SQLite local, connexion hors ligne
└── docs/                 Documentation technique
```

**Stack** : TypeScript · React 19 · Vite · Tailwind CSS v4 · shadcn/ui · TanStack Query ·
wouter · Express 5 · Drizzle ORM · PostgreSQL · Zod · Tauri 2.

Documents de référence :

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — règles de structure et invariants
- [`docs/SYNC_STRATEGY.md`](docs/SYNC_STRATEGY.md) — protocole hors ligne
- [`docs/MODULES.md`](docs/MODULES.md) — modules activables et niveaux
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — modèle de données
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — mise en production
- [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) — stratégie et couverture des tests

---

## Choix structurants

**Les montants sont des entiers en centimes**, les taux des points de base. Aucun flottant
ne touche une somme d'argent : c'est ce qui permet de garantir qu'une écriture comptable
est équilibrée au centime.

**Une facture validée est inaltérable.** La correction passe par un avoir, qui produit
l'écriture inverse. Un brouillon, lui, ne consomme pas de numéro légal et n'a aucun effet.

**Le stock n'est jamais écrit directement.** Toute variation passe par un mouvement daté,
motivé et rattaché à son document d'origine ; le solde est la somme des mouvements.

**Le noyau ignore les modules.** La dépendance est strictement `module → noyau`, vérifiée
par une règle ESLint. Ajouter un domaine métier n'implique aucune modification du noyau.

**Le client hors ligne produit des intentions, pas des vérités.** Numérotation légale,
stock consolidé et écritures restent décidés par le serveur, à l'ingestion.

---

## Licence et livraison

Projet livré clé en main. Avant mise en production, voir la checklist de
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — en particulier la génération d'un
`JWT_SECRET` propre et le changement du mot de passe administrateur.
