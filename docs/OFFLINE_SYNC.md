# Poste desktop offline-first

Ce document décrit le fonctionnement **offline-first** de l'application desktop (Tauri) :
une base SQLite locale par société, synchronisée avec PostgreSQL. Il complète
[`SYNC_STRATEGY.md`](SYNC_STRATEGY.md), qui décrit le protocole d'envoi historique
(idempotence par `client_uuid`, journal `sync_operations`, intentions rejouées par le
serveur) — protocole toujours en vigueur et étendu ici.

L'application web n'est pas concernée : elle garde son chemin (API, cache HTTP,
instantané IndexedDB).

---

## 1. Architecture

```
                 PostgreSQL (source de vérité)
                 │  triggers → sync_changes (journal des changements)
                 │  colonne version (incrémentée par trigger)
                 ▼
           API Express  /api/sync/bootstrap · /pull?cursor= · /push
                 ▲
                 │ HTTPS
┌────────────────┴────────────────────── Poste desktop ─────────────────┐
│ Écrans React ── entities/*/api.ts ── readLocalFirst / writeLocalFirst │
│                                   │                                   │
│                     offline/local/ (TypeScript, fenêtre Tauri)        │
│    local-reads · local-writes · local-pos · replication · local-push  │
│                                   │  commandes Tauri (local_*)        │
│                                   ▼                                   │
│    src-tauri/src/local_db (Rust) : companies/<société>.sqlite         │
│      tables d'entités · sync_queue · sync_meta · bootstrap_progress   │
│      sync_conflicts · sync_log                                        │
└───────────────────────────────────────────────────────────────────────┘
```

- **Une base SQLite par société et par poste** : `<app data>/companies/<id>.sqlite`.
  Une seule est ouverte à la fois ; chaque commande Rust nomme la société attendue et
  est refusée si ce n'est pas celle ouverte ; une ligne d'une autre société est refusée.
  Le changement de société (nouvelle connexion) ferme l'ancienne base avant d'ouvrir la
  nouvelle ; la déconnexion la ferme (son contenu, envois en attente compris, reste sur
  le disque).
- **Le moteur de synchronisation reste en TypeScript** (`sync-engine.ts`) : il réutilise
  le client HTTP, l'authentification, la détection réseau, les reprises et les
  traductions. Sur le desktop, il bascule en **mode local** dès que la base de la
  société est ouverte (`offline/local/local-sync.ts`).
- **Une entité est « prête »** quand elle a été téléchargée en entier. Ses écrans lisent
  alors SQLite (`readLocalFirst`) ; avant, ou si elle devient périmée, ils gardent
  l'ancien chemin. Aucun écran n'affiche une base à moitié remplie.

### Ce qui passe par SQLite aujourd'hui

| Domaine                                                  | Lecture                                                         | Écriture                                  |
| -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Produits (variantes, fournisseurs), catégories, services | SQLite                                                          | SQLite + `sync_queue`                     |
| Tiers (contacts, adresses, solde, historique)            | SQLite                                                          | SQLite + `sync_queue`                     |
| Magasins, stock, stock bas, caisses, comptes de paiement | SQLite                                                          | — (administration en ligne)               |
| Caisse : session, ticket, règlements, résumé, clôture    | SQLite                                                          | SQLite + `sync_queue`                     |
| Devis, commandes, factures, avoirs, règlements, achats   | **synchronisés** dans SQLite, écrans encore sur l'ancien chemin | ancien chemin (en ligne, file en secours) |
| Comptabilité, rapports, administration                   | serveur / cache HTTP                                            | serveur / file HTTP générique             |

---

## 2. Première synchronisation (bootstrap)

1. `POST /api/sync/bootstrap` renvoie :
   - le **curseur de départ** ;
   - la fenêtre d'historique (`since`, 12 mois) ;
   - les entités que la personne a le droit de recevoir, dans l'ordre des dépendances, avec leur nombre de lignes.
2. Pour chaque entité, `GET /api/sync/bootstrap/:entity?after=<id>&limit=500&since=` sert
   des pages triées par identifiant croissant. Chaque page est écrite dans **une seule
   transaction SQLite avec sa progression** (`bootstrap_progress`).
3. Quand toutes les pages sont là, le curseur de départ devient `last_sync_cursor`, dans
   la même transaction que `bootstrap_completed_at`. Le `pull` prend le relais.

**Pourquoi le curseur est pris avant la première page.** Tout ce qui change pendant le
téléchargement est postérieur au curseur, donc servi à nouveau par le `pull` :

- **rien n'est perdu** : une ligne supprimée entre deux pages arrive comme `DELETE` ;
- **rien n'est doublé** : l'écriture locale se fait par identifiant, et une version plus
  ancienne ne remplace jamais une plus récente.

**Reprise.** Coupure réseau, fermeture ou plantage : la reprise repart après la dernière
page enregistrée, avec le même curseur. Une page n'est jamais écrite à moitié.

**Historique.** Les documents des 12 derniers mois, plus tout ce qui n'est pas terminé
quel que soit son âge : brouillons, factures non soldées, session de caisse ouverte et ses
règlements. Les documents plus anciens restent lisibles depuis le cache s'ils y sont.

**Progression.** Elle s'affiche dans le bandeau de préparation existant et dans le menu de
l'indicateur de synchronisation.

---

## 3. Pull : les changements du serveur

`GET /api/sync/pull?cursor=<entier>&limit=500` →
`{ cursor, hasMore, resync, scope, changes: [{ entity, entityId, operation: UPSERT|DELETE, version, data }] }`.

- **Journal.** `sync_changes` est rempli **uniquement par des triggers PostgreSQL**
  (migration 0006) : insertions, modifications, **suppressions physiques** comprises. Aucun
  chemin de code ne peut oublier d'enregistrer un changement.
- **Documents complets.** Un changement de ligne de document, de variante ou de contact est
  enregistré **sur le parent**. Le poste reçoit le document entier, lignes supprimées
  comprises.
- **Un envoi par ligne.** Chaque ligne changée est envoyée une fois par page, dans son état
  actuel.

### Le curseur

Le curseur est un entier : l'identifiant de la **dernière transaction servie en entier**.
Seules les transactions terminées sont servies, c'est-à-dire celles sous
`pg_snapshot_xmin(pg_current_snapshot())`, et une page s'arrête entre deux transactions.

Pourquoi pas un simple compteur (`seq`) : la transaction A obtient le n° 6, B obtient le
n° 7 et se termine la première. Un poste qui lit « jusqu'à 7 » ne verrait jamais le 6.
Avec l'identifiant de transaction, une transaction qui se termine plus tard a forcément un
identifiant plus grand que le curseur. Le test `sync-changes.test.ts` joue exactement ce
scénario.

Contrepartie : une transaction qui reste longtemps ouverte sur le serveur **retarde**
la livraison des suivantes. Elle ne les fait jamais perdre.

### Périmètre de droits

La base d'une société est partagée par les personnes qui utilisent le poste, mais le
serveur ne sert à chacune que ce qu'elle a le droit de voir, et l'indique dans `scope`.
Deux cas :

- **Une entité du poste sort du périmètre** (un caissier synchronise alors qu'un
  responsable avait téléchargé les achats) : elle devient **périmée**. Ses écrans cessent
  de lire SQLite, et elle est **re-téléchargée en entier** à la prochaine synchronisation
  d'une personne autorisée.
- **Une entité entre dans le périmètre** : elle est téléchargée.

### Purge et resync

- **Purge.** Le journal est purgé au-delà de 30 jours, une fois par heure et par processus
  serveur. `sync_horizon` retient jusqu'où la purge est allée.
- **Resync.** Un poste dont le curseur est plus ancien reçoit `resync: true`. Il
  re-télécharge alors tout, **sans perdre ses modifications locales ni sa file**.

---

## 4. Écritures locales et `sync_queue`

Pour une écriture sur le poste, la ligne locale et son opération sont écrites dans une
seule transaction SQLite :

```
BEGIN
  INSERT/UPDATE <entité>  (pending = 1)
  INSERT sync_queue       (CREATE | UPDATE | DELETE)
COMMIT
```

Une donnée sans opération, ou une opération sans donnée, est impossible.

### Colonnes de `sync_queue`

| Colonne                                        | Rôle                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `id`                                           | Clé d'idempotence envoyée au serveur (`clientUuid`)                |
| `seq`                                          | Ordre causal                                                       |
| `entity`                                       | Entité du protocole                                                |
| `local_table`, `entity_id`                     | Ligne locale concernée                                             |
| `operation`                                    | `CREATE`, `UPDATE` ou `DELETE`                                     |
| `payload`                                      | Contenu de l'opération                                             |
| `depends_on`                                   | Opérations à attendre avant celle-ci                               |
| `base_version`                                 | Version serveur dont la modification est partie                    |
| `user_id`                                      | Personne à l'origine de l'opération                                |
| `status`                                       | `pending`, `sending`, `synced`, `failed`, `conflict` ou `deferred` |
| `retry_count`, `next_attempt_at`, `last_error` | Reprises et dernière erreur                                        |
| `server_id`, `assigned_number`                 | Réponse du serveur (identifiant, numéro légal)                     |

### Règles d'écriture

- **Création.** La ligne reçoit ici son identifiant définitif : l'identifiant de
  l'opération de création, que le serveur garde (`offlineId`, section 7).
- **Modification.** Seuls les champs **réellement changés** sont envoyés, avec :
  - leur valeur de départ (`base`) ;
  - la version serveur de départ (`base_version`).

  Envoyer un champ inchangé déclencherait un conflit sur un champ que personne n'a touché.

- **Dépendances.** Une modification d'une ligne créée ici, et pas encore acceptée par le
  serveur, attend sa création (`depends_on`). Le serveur répond « reporté » au lieu
  d'échouer.
- **Suppression.** Elle archive la ligne (`is_active = false`), comme en ligne. La ligne
  est marquée `deleted_at` (marque de suppression locale) jusqu'à la confirmation du
  serveur.

### Caisse

Une vente est écrite en local, dans une seule transaction :

- **le ticket** : une facture validée, avec un numéro provisoire `OFFLINE-TKT-…` ;
- **ses règlements** ;
- **leurs opérations** dans `sync_queue` ;
- **des lignes « dérivées »** pour ce que le serveur calculera : le stock restant dans le
  magasin de la caisse et les totaux de la session.

Une ligne dérivée garde sa version et n'est pas marquée en attente : le chiffre du serveur
la remplace au `pull` suivant. Avec internet, la caisse attend au plus 4 secondes le
numéro légal, pour l'imprimer comme en ligne. Sans internet, le ticket porte le numéro
provisoire.

---

## 5. Push : l'envoi

`POST /api/sync/push`, étendu sans rien changer pour les postes 1.0.0 :

- `action` : `create`, `update` ou `delete`, avec `entityId` et `baseVersion` ;
- résultat par opération : `status` (valeurs historiques `created`, `duplicate`,
  `error`, `deferred`, plus `conflict`) et `outcome` (`success`, `conflict`, `failed`,
  `deferred`) ;
- `record` : l'état serveur de la ligne, qui est enregistré immédiatement sur le poste.

Il n'y a jamais de `409` global : un lot contient des succès, des conflits et des refus,
chacun avec son propre statut.

### Côté poste (`local-push.ts`)

- **Envoi.** Les opérations partent par lots de 50 dans l'ordre `seq`. Les écritures HTTP
  génériques sont rejouées une par une.
- **Réponse.** Chaque réponse est enregistrée avec son effet sur la ligne locale, dans une
  seule transaction (`local_queue_ack`) :
  - **acceptée** : la ligne serveur remplace la ligne locale. Elle n'est plus en attente
    une fois sa dernière opération acceptée ;
  - **conflit** : les deux versions sont gardées, et la version locale reste affichée ;
  - **refusée** : l'opération est gardée et marquée `failed`.
- **Coupure réseau.** Ce qui était en cours d'envoi repart en file.
- **Erreur serveur (5xx).** Nouvel essai à 1 min, puis 2, 4… jusqu'à 30 min.

---

## 6. Conflits

| Données                                            | Stratégie                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| Produits, tiers, services, catégories              | Comparaison de versions et fusion champ par champ (ci-dessous)             |
| Tickets, factures validées, règlements, mouvements | Ajout seul, jamais modifiés : pas de conflit                               |
| Stock                                              | Le poste n'envoie que des mouvements, et les mouvements s'additionnent     |
| Sessions de caisse                                 | Le serveur fait foi pour les totaux ; l'écart est recalculé à la réception |

### Données de référence (`server/domains/sync/master-data.ts`)

Sous verrou de ligne, le serveur compare la version :

- **même version que `base_version`** : la modification est appliquée ;
- **sinon**, champ par champ :
  - **valeur serveur toujours égale à `base`** : seul ce poste a changé le champ, il est
    appliqué ;
  - **valeur serveur changée aussi, et différente** :
    - **champ sensible** : **conflit explicite**. Rien n'est écrit, et le poste reçoit la
      version serveur ;
    - **autre champ** : la dernière modification reçue l'emporte.

Champs sensibles :

- produits : prix de vente, prix d'achat, variantes ;
- tiers : limite de crédit, délai de paiement ;
- services : prix.

Sur le poste, l'indicateur passe à l'état « changements à vérifier ». Sa fenêtre montre
les deux versions, montants en MRU :

- « Garder ma version » renvoie la modification sur la version serveur ;
- « Garder l'autre version » affiche la version serveur et abandonne la modification locale.

Une opération refusée peut être réessayée ou abandonnée :

- l'abandon d'une **création** retire sa ligne locale ;
- l'abandon d'une **modification** fait re-télécharger l'entité.

---

## 7. Identifiants et suppressions

- **UUID partout.** Une entité créée hors ligne (tiers, produit, catégorie, service,
  devis, facture, règlement, session) est enregistrée dans PostgreSQL **avec l'identifiant
  généré sur le poste** : `id = client_uuid` (`server/shared/db/offline-id.ts`).
  L'identifiant est le même partout, et les opérations suivantes peuvent le nommer avant
  même l'accusé de réception.
- **Suppressions côté serveur.** Les données de référence sont archivées
  (`is_active = false`), jamais supprimées. Les suppressions physiques (lignes de document
  remplacées, liens) sont captées par les triggers et livrées au poste. PostgreSQL n'a donc
  pas besoin de `deleted_at` : la ligne `D` de `sync_changes` joue le rôle de marque de
  suppression.
- **Suppressions côté poste.** `deleted_at` marque une suppression faite sur le poste, en
  attendant la confirmation du serveur.

---

## 8. Hors ligne, reprise après plantage

- **Détection.** L'état réseau vient de `navigator.onLine` **et** d'un ping
  `GET /api/health`. Les déclencheurs sont le retour du réseau, le retour au premier plan,
  une minuterie de 60 s et le bouton « Envoyer maintenant ».
- **Un seul cycle à la fois.** Un cycle envoie la file, puis fait le `pull`, puis purge
  les opérations acceptées depuis plus de 7 jours.
- **Reprise après plantage :**
  - **Opérations `sending`.** Celles d'un lancement précédent repartent en file à
    l'ouverture de la base (`local_open`), ce qui est journalisé.
  - **Transactions interrompues.** Une page, une écriture ou un accusé de réception
    interrompu n'a jamais été validé. SQLite est en mode WAL avec `synchronous = FULL` :
    une vente validée résiste à une coupure de courant.
- **Journal du poste.** `sync_log` garde les 2 000 derniers événements : début et fin
  d'envoi, envois, réceptions, reprises, conflits, erreurs. Il ne contient jamais de jeton
  ni de mot de passe. Il est consultable sur l'écran technique « Synchronisation ».

---

## 9. Migrations

### PostgreSQL

La migration `migrations/0006_sync_changes.sql` a été générée par drizzle-kit, puis
complétée à la main pour les triggers. Elle ajoute :

- la colonne `version` (valeur 1 pour les lignes existantes) sur les 20 tables racines ;
- les tables `sync_changes` et `sync_horizon`, et leurs index ;
- les fonctions `sync_bump_version`, `sync_log_rows` et `sync_touch_parent`, et les triggers.

Elle est versionnée, reproductible, et ne change pas le comportement du web.

À appliquer avec `npm run db:migrate` **après avoir vérifié l'URL de la base cible**.

### SQLite

La liste `MIGRATIONS` de `src-tauri/src/local_db/migrations.rs` est versionnée par
`PRAGMA user_version`. Chaque étape est une transaction. Une entrée publiée n'est jamais
modifiée ; un changement est une nouvelle entrée à la fin.

### Ancienne file

Les opérations de l'ancienne file (IndexedDB et `offline.sqlite`) non encore acceptées
sont copiées **une fois** dans `sync_queue` :

- avec le même identifiant, le même ordre et le même état ;
- seulement pour la société à laquelle elles appartiennent ;
- les originaux restent en place comme copie de sécurité.

### Tests

Les tests d'intégration refusent toute base qui n'est pas locale
(`scripts/test-database.ts`). Préparer la base de test : `docker compose up -d db` puis
`npm run test:db`.

---

## 10. Ajouter une entité à la synchronisation

1. **PostgreSQL.** Dans une nouvelle migration, ajouter la colonne
   `version integer default 1 not null` (Drizzle : `syncVersion()`) et les triggers
   `sync_version` et `sync_log_*`, comme dans 0006. Pour une table enfant, ajouter
   `sync_touch_parent` vers son parent.
2. **Contrat partagé.** Ajouter l'entité à `SYNC_TABLES` (`shared/sync-protocol.ts`), à la
   place que lui donnent ses dépendances.
3. **Serveur.** Dans `server/domains/sync/entities.ts`, déclarer :
   - les droits de lecture et le module ;
   - les lignes enfants ;
   - la fenêtre d'historique ;
   - les colonnes à ne jamais envoyer.
4. **Poste.** Ajouter une entrée `MIGRATIONS` (`local_db/migrations.rs`) qui crée la table
   locale (`entity_table!`) avec les colonnes calculées à filtrer, et les index utiles.
   Ajouter aussi l'entité à `ENTITIES`.
5. **Écritures, si elle est modifiable hors ligne :**
   - un gestionnaire dans le répartiteur (`handlers.ts`, ou `master-data.ts` avec ses
     champs sensibles) qui rejoue le cas d'usage en ligne ;
   - une entrée dans `SYNC_ENTITY_TABLES` ;
   - une entrée dans `local-writes.ts`.
6. **Lectures.** Écrire une fonction dans `local-reads.ts` qui reproduit exactement la
   réponse de la route serveur, et l'appeler via `readLocalFirst` dans `entities/*/api.ts`.
7. **Tests.** Ajouter des tests serveur (`sync-replication.test.ts`) et client
   (`local-reads-writes.test.ts`).

---

## 11. Limites connues

- **Documents.** Les écrans des devis, commandes, factures, avoirs, règlements et achats
  ne lisent pas encore SQLite, bien que leurs données y soient synchronisées. Leurs
  créations passent encore par l'ancien chemin : en ligne d'abord, puis file en secours.
- **Stock initial d'un produit créé hors ligne.** Il apparaît après la synchronisation.
- **Stock dérivé d'une vente.** Il n'est mis à jour que pour une ligne de stock déjà
  présente dans le magasin de la caisse.
- **Connexion hors ligne à froid.** Elle passe encore par l'instantané de
  `offline.sqlite`, qui continue d'être rafraîchi.
- **Chiffrement.** La base locale n'est pas chiffrée. Elle est isolée par société, dans le
  dossier de l'application, et contient les données de travail. Les empreintes de mot de
  passe restent dans `offline.sqlite`, réservées aux caissiers d'un poste approuvé.
- **Images.** Les images des produits sont synchronisées comme adresses (URL ou
  `data:`). Aucun cache local de fichiers binaires n'est encore en place.
