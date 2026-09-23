# Stratégie de synchronisation Online / Offline

Le produit doit rester **pleinement opérationnel hors ligne**, et les données doivent
remonter **exactement une fois** au retour du réseau. Ce document décrit comment.

---

## 1. Principes

1. **Offline-first.** L'interface écrit d'abord localement, puis synchronise. L'absence de
   réseau n'interrompt jamais une vente.
2. **Le serveur fait autorité** sur les invariants critiques : numérotation légale, stock
   consolidé, écritures comptables. Le client produit des **intentions**.
3. **Idempotence par `client_uuid`.** Chaque opération hors ligne porte un UUID généré sur
   le poste ; la base en fait une contrainte d'unicité. Un rejeu ne crée jamais de doublon.
4. **Documents en ajout seul.** Factures, règlements et mouvements ne sont jamais écrasés
   par la synchronisation ; les corrections passent par des avoirs. Cela supprime la
   majorité des conflits.
5. **Sans état, par lots.** Aucun processus permanent n'est requis côté serveur.

---

## 2. Composants

```
┌───────────────────── Poste ──────────────────────┐
│ Service Worker   coquille applicative en cache    │
│ IndexedDB (web) / SQLite (desktop) :              │
│   · instantané  catalogue, tiers, stock, modules  │
│   · OUTBOX      opérations en attente             │
│   · meta        curseur, séquence locale          │
│ Moteur de sync   détecte, vide la file, tire le delta │
└──────────┬───────────────────────────┬────────────┘
           │ POST /api/sync/push       │ GET /api/sync/pull?since=
┌──────────▼───────────────────────────▼────────────┐
│ Serveur : répartiteur d'entités → cas d'usage      │
│ UNIQUE(client_uuid) sur chaque entité synchronisable│
└────────────────────────────────────────────────────┘
```

Le choix du support local dépend de l'hôte, derrière un contrat unique
(`client/src/shared/offline/storage.ts`) :

- **navigateur** → IndexedDB. Disponible partout ; peut être évincé sous pression disque.
- **coquille desktop** → SQLite dans le dossier applicatif. Rien ne l'évince — ce qui compte
  sur un poste qui peut accumuler une journée de ventes non synchronisées. L'écriture est
  doublée dans IndexedDB pour la vitesse de lecture ; si le profil de la webview est
  réinitialisé, la file est restaurée depuis SQLite.

---

## 3. Cycle de vie d'une vente hors ligne

```
1. Le caissier encaisse un ticket. Aucun réseau.
2. Le client génère client_uuid (UUIDv4) et un numéro PROVISOIRE « OFFLINE-TKT-0003 ».
3. Écriture dans l'OUTBOX : facture, puis règlement qui déclare la facture en dépendance.
4. Rien n'est envoyé ; les opérations restent « pending » et survivent à la fermeture.
5. Retour réseau — détecté par événement navigateur ET ping GET /api/health.
6. POST /api/sync/push, dans l'ordre causal (localSeq croissant).
7. Le serveur, pour chaque opération :
     · client_uuid déjà connu       → « duplicate », renvoie l'existant, n'écrit rien
     · dépendance non résolue       → « deferred », rien n'est écrit, à rejouer
     · sinon                        → rejoue le cas d'usage métier complet
8. Réponse : l'UI remplace le numéro provisoire par le numéro légal et purge la file.
9. GET /api/sync/pull?since= → récupère les changements des autres postes.
```

### Ordre de rejeu

Deux mécanismes complémentaires :

- **`localSeq`**, compteur monotone persistant du poste, fixe l'ordre global ;
- **`dependsOn`**, liste de `client_uuid`, exprime les dépendances explicites (un règlement
  dépend de sa facture, une facture POS dépend de l'ouverture de session).

Une dépendance non encore ingérée donne `deferred` — **pas** `error`. La nuance est
importante : un report est rejoué au cycle suivant, alors qu'une erreur reste bloquée en
attente d'une décision humaine.

### Résolution des références croisées

Une facture créée hors ligne peut référencer un client lui aussi créé hors ligne. Le payload
porte alors `partyClientUuid` au lieu de `partyId` ; le serveur résout la référence via le
journal `sync_operations` ou via les opérations déjà traitées **dans le même lot**.

---

## 4. Idempotence

| Mécanisme    | Mise en œuvre                                                               |
| ------------ | --------------------------------------------------------------------------- |
| Clé          | `client_uuid` (UUIDv4 généré sur le poste)                                  |
| Contrainte   | Index unique sur `client_uuid`, sur chaque entité synchronisable            |
| Journal      | `sync_operations`, unique sur `client_uuid`, mémorise statut et `server_id` |
| Ingestion    | Recherche préalable dans le journal ; collision ⇒ renvoi de l'existant      |
| Rejeu réseau | Un `push` renvoyé après timeout est sans effet au-delà du premier           |

**Une transaction par opération, pas par lot.** Si la cinquième opération échoue, les quatre
précédentes restent acquittées. Un lot entièrement rejeté obligerait le poste à tout
renvoyer, et une erreur permanente sur une seule opération bloquerait la file indéfiniment.

---

## 5. Numérotation légale

Deux postes hors ligne ne peuvent pas allouer de numéro définitif sans risque de collision.
La solution :

- **numéro provisoire local** visible hors ligne (`OFFLINE-TKT-0003`), stocké dans
  `provisional_number` ;
- **numéro définitif attribué par le serveur** à l'ingestion, par `INSERT … ON CONFLICT DO
UPDATE … RETURNING` sur la ligne de séquence — verrouillée le temps de l'incrément, donc
  sûre même sous concurrence ;
- la correspondance `client_uuid ↔ numéro` est conservée pour l'audit.

---

## 6. Conflits

| Type d'entité                                              | Stratégie                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Documents** (factures, règlements, mouvements, sessions) | Ajout seul. Jamais écrasés. Un `client_uuid` connu est un doublon ignoré. Pas de conflit d'écriture possible.                              |
| **Référentiels** (produits, tiers, tarifs)                 | Le serveur fait foi ; le poste reçoit la version serveur au `pull` suivant.                                                                |
| **Stock**                                                  | Le poste n'impose jamais une quantité absolue, seulement des **deltas** (mouvements). Les deltas concurrents s'additionnent naturellement. |

---

## 7. Détection réseau et robustesse

- `navigator.onLine` **plus** un ping `GET /api/health` : un poste connecté au Wi-Fi d'un
  magasin dont la liaison est coupée se croit en ligne. Le ping tranche.
- **Backoff exponentiel** après échec : 2 s, 4 s, 8 s… plafonné à 60 s.
- **Déclencheurs cumulés** de synchronisation, parce qu'aucun ne suffit seul : retour de
  connectivité, reprise de focus, onglet redevenu visible, minuteur de 60 s, message du
  Service Worker.
- Le Service Worker ne rejoue pas lui-même les opérations — il n'a pas accès au jeton. Il
  **réveille les onglets** (`postMessage`), qui relancent le cycle.
- IndexedDB et SQLite survivent à la fermeture : l'exigence « fermer puis rouvrir → les
  données sont toujours là » est satisfaite.

---

## 8. Sécurité de la file locale

- Périmètre local **minimal** : ce qui est nécessaire à la vente, rien de plus. Ni
  comptabilité, ni historique de factures, ni données d'autres sociétés.
- Purge du cache de lecture à la déconnexion. **La file d'attente, elle, n'est jamais
  purgée automatiquement** : des ventes non synchronisées ne doivent pas disparaître parce
  qu'un utilisateur s'est déconnecté. Leur abandon est une action explicite.
- Les empreintes bcrypt permettant la connexion hors ligne à froid ne sont envoyées que sur
  la plateforme **desktop**, où elles vivent dans un SQLite applicatif. En PWA web, la
  réouverture hors ligne s'appuie sur la session déjà établie.

---

## 9. Entités synchronisables

| Entité                     | Effet à l'ingestion                                           |
| -------------------------- | ------------------------------------------------------------- |
| `core.party`               | Création du tiers, code attribué par le serveur               |
| `catalog.product`          | Création du produit                                           |
| `sales.quote`              | Devis numéroté                                                |
| `invoicing.sales_invoice`  | Facture **validée** : numéro légal, stock, écriture comptable |
| `payments.payment`         | Imputation facture + mouvement de trésorerie + écriture       |
| `pos.session_open`         | Ouverture de session de caisse                                |
| `pos.session_close`        | Clôture, recalcul de l'attendu et de l'écart                  |
| `inventory.stock_movement` | Mouvement d'ajustement                                        |

Ajouter une entité consiste à enregistrer un handler auprès du répartiteur
(`server/domains/sync/dispatcher.ts`) — le moteur lui-même n'est pas modifié.

Chaque handler **rejoue le cas d'usage en ligne**, jamais un `INSERT` direct. C'est ce qui
garantit qu'une facture hors ligne produit exactement les mêmes effets qu'une facture
saisie en ligne : il n'existe pas deux chemins métier à maintenir.

---

## 10. Couverture de test

| Étape du cahier des charges                  | Test                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Couper la connexion                          | `e2e/offline-pos.spec.ts` (`context.setOffline`)                 |
| Créer une facture hors ligne                 | `e2e` + `sync-idempotence.test.ts`                               |
| Fermer puis rouvrir, vérifier la persistance | `outbox.test.ts` (réouverture IndexedDB) + `e2e`                 |
| Rétablir la connexion                        | `e2e`                                                            |
| Synchronisation **sans duplication**         | `sync-idempotence.test.ts` : rejeu ×3, stock décrémenté une fois |
| Recherche OEM hors ligne                     | `snapshot.test.ts`                                               |
