# Rapport de revue — ERP Sahel

_Revue du 27 septembre 2026 — commit `05b7f68` (branche `main`)_

---

## 1. Verdict

L'application **se construit, démarre et fonctionne** pour le parcours normal : connexion,
tableau de bord, caisse, factures, stock, achats, comptabilité, et même **la vente sans
internet puis l'envoi au retour du réseau** (testé dans un vrai navigateur). Le code est
bien organisé, bien typé, et la traduction fr / ar / en est complète.

**Mais elle n'est pas prête pour la production.** J'ai reproduit sur une base de test des
failles graves :

- un employé peut **prendre le contrôle du compte super-administrateur** ;
- un compte « lecture seule » peut **modifier le stock** ;
- plusieurs erreurs sur **l'argent** : remboursements (avoirs) plus élevés que la facture,
  facture négative, ticket entier annulé pour un seul article rendu.

Par ailleurs, **plusieurs tests automatiques échouent** parce qu'ils n'ont pas été mis à
jour depuis la suppression de la TVA.

| Priorité                       | Nombre | Dont reproduits en test |
| ------------------------------ | -----: | ----------------------: |
| 🔴 Critique (à corriger avant la mise en service) | 13 | 8 |
| 🟠 Important                    | 28 | 1 |
| 🟡 Mineur                       | ~25 | — |

---

## 2. Ce qui a été testé

Tout a tourné sur une **base PostgreSQL locale et jetable** (`erp_sahel_review`, supprimée
après la revue). **La base Neon de `.env` n'a jamais été touchée.**

| Vérification                                 | Résultat                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Typage TypeScript (`npm run check`)          | ✅ 0 erreur                                                                |
| Lint (`npm run lint`)                        | ⚠️ 4 643 erreurs, **toutes dans `.vercel/output/`** (ancien build non ignoré). 0 erreur dans le code source |
| Migrations sur base vierge (`db:migrate`)    | ✅ passent                                                                 |
| Écart schéma ↔ migrations                    | ❌ 15 tables orphelines (voir §3.12)                                       |
| Données de démonstration (`db:seed`)         | ✅                                                                         |
| Build production (`npm run build`)           | ✅, mais le fichier JS principal pèse **915 Ko** (276 Ko compressé)        |
| Tests unitaires et d'intégration (`npm test`) | ❌ **107 / 111** : 4 échecs, tous dus à des tests pas à jour (voir §5)     |
| Tests navigateur (`npm run test:e2e`)        | ❌ **0 / 3** tels quels : les tests cherchent un titre « Hello » qui n'existe plus |
| Tests navigateur, sélecteur corrigé          | ✅ vente hors ligne + envoi sans doublon · ✅ ouverture de l'application sans réseau · ❌ « toutes les pages hors ligne » bloqué (délai dépassé en attendant que le réseau soit calme) |
| Tous les écrans de liste de l'API (41 adresses) | ✅ tous répondent 200 avec le compte administrateur                     |
| Erreurs JavaScript dans le navigateur        | ✅ aucune sur le tableau de bord                                           |
| Consommation réseau au repos                 | ~53 requêtes de préchargement après la connexion, puis ~1 toutes les 5 s — acceptable |
| Traductions                                  | ✅ 0 clé manquante, 0 texte en dur, 0 abréviation interdite, pas de « ouguiya » |
| Scénarios d'attaque et d'erreurs d'argent    | ❌ 9 problèmes reproduits (marqués **[reproduit]** plus bas)               |

**Environnement local :** le port 5000 (`PORT` par défaut) est déjà occupé sur cette
machine par un autre conteneur (mlflow). `npm run dev` ne démarrera pas tant que `PORT`
n'est pas changé.

---

## 3. 🔴 Problèmes critiques

### Sécurité

**3.1 — Un administrateur de boutique peut prendre le compte super-administrateur.** **[reproduit]**
`server/domains/users/routes.ts:106-137` — `PATCH /api/users/:id` vérifie seulement que la
personne visée est membre de la société, puis modifie la fiche utilisateur **globale**
(mot de passe, actif, email).
_Test :_ un compte « administrateur » ordinaire a changé le mot de passe de `admin`
(super-administrateur), puis s'est connecté avec. Le super-administrateur peut choisir
n'importe quelle société : accès complet à **toutes** les boutiques.
_Correction :_ interdire toute modification d'un super-administrateur sauf par un
super-administrateur ; interdire de changer le mot de passe ou l'état d'une personne
membre d'autres sociétés ; révoquer ses sessions après un changement de mot de passe.

**3.2 — La synchronisation contourne tous les droits.** **[reproduit]**
`server/domains/sync/routes.ts:19-21`, `server/domains/sync/handlers.ts` — `/api/sync/push`
ne vérifie que la connexion, jamais les permissions.
_Test :_ un compte « consultation » (lecture seule) reçoit bien `403` sur les routes
normales, mais via `/api/sync/push` il a **sorti 1 article du stock** (10 → 9). Il peut de
la même façon créer des produits ou des paiements.
_Correction :_ associer une permission à chaque type d'opération dans le répartiteur et la
vérifier avant de rejouer.

**3.3 — N'importe quel compte peut télécharger les mots de passe chiffrés.** **[reproduit]**
`server/domains/sync/snapshot.ts:316-333` — `GET /api/sync/snapshot?platform=desktop`
renvoie les empreintes bcrypt de tous les utilisateurs (administrateurs compris) à
n'importe quel compte connecté. Avec la règle actuelle (8 caractères, bcrypt coût 10),
elles se cassent hors ligne.
_Correction :_ exiger une permission et un poste de bureau enregistré ; exclure
administrateurs et super-administrateurs ; n'envoyer que les comptes autorisés sur ce poste.

**3.4 — Mot de passe par défaut `Admin123!` accepté en production.**
`server/seed.ts:138-160` — aucune protection en production et aucune obligation de le
changer à la première connexion.

### Argent et stock

**3.5 — On peut rembourser plus que la facture.** **[reproduit]**
`server/domains/invoicing/application.ts:308-329` — chaque avoir est comparé au total de la
facture, jamais à la somme des avoirs déjà faits.
_Test :_ facture de 10 000 MRU → deux avoirs de 6 000 MRU acceptés (12 000 MRU remboursés)
→ le client peut ensuite **encore payer les 10 000 MRU** : le montant dû n'a pas bougé.

**3.6 — Un avoir peut contenir n'importe quel article.** **[reproduit]**
Même fichier — les lignes de l'avoir sont libres : un produit absent de la facture, une
quantité supérieure à celle vendue, n'importe quel prix. Avec « remettre en stock », ce
stock apparaît de nulle part.

**3.7 — Rendre un seul article annule tout le ticket payé.** **[reproduit]**
`server/domains/invoicing/application.ts:397-399` — la condition
`avoir >= total − payé` vaut toujours vrai quand la facture est payée (reste dû = 0).
_Test :_ facture payée de 10 000 MRU, retour d'un article à 5 000 MRU → facture passée à
**ANNULÉE**. Elle disparaît du chiffre d'affaires et des meilleures ventes, et plus aucun
retour n'est possible dessus. **Touche chaque retour à la caisse.**

**3.8 — Les avoirs ne réduisent jamais ce que le client doit.**
`server/domains/payments/application.ts:70-77`, `server/domains/parties/repository.ts:150`
— le « reste à payer » et l'encours client ignorent les avoirs. On peut aussi enregistrer un
paiement sur une facture annulée, ce qui la repasse en « payée ».

**3.9 — Facture négative validée.** **[reproduit]**
`server/domains/invoicing/schemas.ts:13-15` — quantité et prix acceptent n'importe quel
nombre (négatif, ou « abc » qui devient 0).
_Test :_ facture validée avec un total de **−500 MRU**, qui produit une écriture comptable
négative.

**3.10 — Paiement enregistré au nom du mauvais client.** **[reproduit]**
`server/domains/payments/application.ts` — rien ne vérifie que la facture appartient au
client indiqué. La facture de A est soldée pendant que la comptabilité crédite B.

**3.11 — Les paiements aux fournisseurs ne sont jamais imputés.**
`server/domains/payments/application.ts:65-123` — `supplier_invoices.paid_amount_cents` et
le statut ne changent jamais : impossible de savoir ce qu'on doit aux fournisseurs. Aucun
contrôle de dépassement non plus. _(Lu dans le code ; les données de démonstration n'ont
pas de facture fournisseur pour le reproduire.)_

### Hors ligne

**3.12 — Des ventes faites sans internet peuvent être perdues pour toujours.**
`client/src/shared/offline/sync-engine.ts:111-128`, `client/src/shared/offline/outbox.ts:15,96`
— avant l'envoi, les ventes passent en état « envoi en cours ». Si le réseau coupe ou si
l'onglet se ferme pendant la requête, **rien ne les remet en attente** : elles ne sont plus
renvoyées ni comptées comme « en attente ». Avec un réseau mobile instable, c'est un
scénario quotidien.
_Correction :_ en cas d'échec, les remettre en attente ; au démarrage, remettre en attente
tout « envoi en cours » de plus de 2 minutes.

**3.13 — Pas d'écran de secours en cas d'erreur.** Aucune « error boundary » React : une
erreur d'affichage, ou une page non chargée après une mise à jour, laisse un **écran blanc**
sans bouton pour recharger.

---

## 4. 🟠 Problèmes importants

### Sécurité et fiabilité du serveur

| # | Problème | Où |
|---|----------|----|
| 4.1 | Une opération en « erreur » dans le journal de synchronisation y reste même après un nouvel essai réussi. Les opérations qui en dépendent (paiement d'une vente) restent bloquées. | `sync/application.ts:303, 419-441`, `sync/repository.ts:41-53` |
| 4.2 | La ligne du journal de synchronisation est écrite **hors** de la transaction métier. Un plantage entre les deux empêche l'appareil de recevoir le numéro définitif. | `sync/application.ts:340-368` |
| 4.3 | La création de produit hors ligne ignore la transaction et la clé d'unicité : doublons possibles. | `sync/handlers.ts:77-90` |
| 4.4 | Anti-doublon HTTP non atomique : deux envois simultanés de la même requête créent deux factures ou deux paiements. | `middleware/idempotency.ts:160-228` |
| 4.5 | Renouvellement de session non atomique, sans détection de réutilisation d'un jeton volé. | `auth/application.ts:157-164` |
| 4.6 | La récupération des changements (`/api/sync/pull`) peut en manquer définitivement (curseur pris avant la requête, limites 2000/500/5000 tronquées en silence). | `sync/service.ts:140-181` |
| 4.7 | La limitation des tentatives de connexion ne fonctionne pas sur Vercel (compteur en mémoire par instance). Ailleurs, 20 essais par IP peuvent bloquer toute une boutique derrière un même routeur. | `middleware/rate-limit.ts` |
| 4.8 | Un mouvement de stock accepte un produit ou un dépôt d'une autre société. | `inventory/service.ts:31-38` |
| 4.9 | **Migrations cassées** : `0000_initial.sql` crée 15 tables qui n'existent plus dans le code (`ap_*`, `cl_*`, `mk_*`, `installed_plugins`). Le prochain `drizzle-kit generate` produira des `DROP TABLE`. `0002` n'a pas d'instantané. La CI utilise `push --force` au lieu des migrations, et ni l'image Docker ni Vercel n'ont d'étape de migration. | `migrations/` |

### Logique métier

| # | Problème | Où |
|---|----------|----|
| 4.10 | Un avoir complet sur une facture avec remise globale est **refusé**. **[reproduit]** Facture 10 000 MRU − 10 % = 9 000 MRU → l'avoir recalculé vaut 10 000 MRU → « dépasse la facture ». | `invoicing/application.ts:323` |
| 4.11 | Les ventes hors ligne passent par un chemin qui saute trois contrôles : caisse ouverte, paiements = total, compteurs de la session. Deux caisses qui vendent le dernier article : une vente est refusée après que l'argent a été encaissé. | `sync/handlers.ts:113-146` |
| 4.12 | Lots : la vente ne précise jamais le lot, donc le stock reçu avec un numéro de lot est invisible pour la vente (« stock insuffisant ») alors qu'il est affiché comme disponible. Les variantes ignorent aussi leur propre prix. | `inventory/application.ts:215-229`, `shared/documents/line-builder.ts:117` |
| 4.13 | Changer seulement la remise globale d'un brouillon ne recalcule pas le total (factures et commandes d'achat). | `invoicing/application.ts:251-260`, `purchasing/application.ts:120-133` |
| 4.14 | Réception d'achat : on peut recevoir plus que commandé, recevoir une commande annulée, et modifier une commande partiellement reçue remet les quantités reçues à 0. | `purchasing/application.ts:127-204` |
| 4.15 | Coût moyen faux : la réception ignore les remises, un coût manquant vaut 0, et la formule est fausse quand le stock est négatif. | `purchasing/order-detail.tsx:256`, `inventory/application.ts:103-107` |
| 4.16 | Le caissier peut vendre à n'importe quel prix (prix envoyé par le navigateur accepté sans permission). Sur un achat, un prix manquant prend le **prix de vente**. | `shared/documents/line-builder.ts:117` |
| 4.17 | Rapports : les achats comptent les brouillons et commandes annulées ; la « marge » = ventes − commandes d'achat (ce n'est pas une marge) ; les retours partiels ne sont pas retirés du chiffre d'affaires. | `purchasing/repository.ts:243-256`, `reports/application.ts:62` |
| 4.18 | **Débordement au-delà de 21 474 836 MRU** : les sommes sont converties en `::int` (balance, chiffre d'affaires, trésorerie) et `bank_accounts.balance_cents` est un `integer`. Une boutique moyenne dépasse ce total de ventes en environ un an → la balance comptable plante. | `accounting/repository.ts`, `invoicing/repository.ts`, `banking/repository.ts` |
| 4.19 | Caisse/banque et comptabilité divergent : les virements entre comptes, les mouvements manuels et l'écart de caisse à la fermeture ne créent aucune écriture. | `banking/application.ts:84-90` |
| 4.20 | Exercices : la clôture ne fait que poser un drapeau (pas de report à nouveau) ; des exercices qui se chevauchent sont acceptés. | `accounting/service.ts:181-189` |
| 4.21 | Une facture à 0 MRU (article offert, remise 100 %) ne peut pas être validée. | `accounting/application.ts:112-117` |

### Interface et hors ligne

| # | Problème | Où |
|---|----------|----|
| 4.22 | Service Worker : le nom du cache ne change jamais (les vieux fichiers s'accumulent sur le téléphone) ; une page d'erreur 5xx peut remplacer l'application hors ligne ; pas de délai maximum sur réseau lent (l'application peut rester figée 30 s en 2G). | `client/public/sw.js:105-109` |
| 4.23 | Caisse : effacer le champ quantité pour retaper supprime la ligne ; les chiffres arabes (٣) deviennent 0. | `pages/pos.tsx:411-419` |
| 4.24 | Saisie des montants : « ١٢٥٠ » devient 0, « 1,500 » devient 1,50 MRU, « 1.500 » devient 1,5 MRU. | `shared/money.ts:57-72` |
| 4.25 | Fermeture de caisse hors ligne : le montant attendu ignore les ventes en espèces, ce qui affiche un faux écart en rouge. Un montant compté vide est accepté sans confirmation. La caisse continue aussi d'utiliser une session fermée depuis un autre appareil. | `pages/pos.tsx:132-139, 865-945` |
| 4.26 | Pas de confirmation avant les actions définitives (archiver, valider une facture, annuler une commande). `shared/components/delete-dialog.tsx` existe mais n'est utilisé nulle part. | `catalog/categories.tsx:86`, `invoicing/invoice-detail.tsx:111`… |
| 4.27 | Après une validation ou un paiement, le stock, le tableau de bord, la dette client et la caisse ne se rafraîchissent pas. | `invoicing/invoice-detail.tsx:73,189`, `pages/pos.tsx` |
| 4.28 | Lignes vides supprimées sans le dire ; bouton grisé sans explication. | `features/documents/line-editor.tsx:64-67` |

---

## 5. 🟡 Tests automatiques à remettre à jour

Ce ne sont pas des bugs de l'application, mais aujourd'hui **aucun test automatique ne
protège contre une régression** : la suite est rouge, donc un vrai échec passerait
inaperçu.

| Test | Pourquoi il échoue | Correction |
|------|--------------------|------------|
| `server/__tests__/sync-idempotence.test.ts:131, 161` (3 tests) | Paiement de 34 800 pour une facture de 30 000 : montant de l'époque de la TVA à 16 %. | Remplacer par 30 000 |
| `server/__tests__/isolation-rbac.test.ts:138` | Attend plus de 30 permissions ; il y en a exactement 30. | `toBeGreaterThanOrEqual(30)` ou comparer au catalogue |
| `e2e/offline-pos.spec.ts:38`, `e2e/offline-all-pages.spec.ts:77` | Cherchent un titre « Hello » absent du tableau de bord. | Attendre un élément réel (ex. « Total sales ») |
| `e2e/offline-all-pages.spec.ts:127` | Reste bloqué sur `waitForLoadState("networkidle")` après le préchargement. | Remplacer par une attente sur un état précis |
| `README.md` | Annonce « 80 tests » : il y en a 111. | Mettre à jour |

Autres points sur les tests :

- `eslint.config.js` n'ignore pas `.vercel/`, ce qui produit 4 643 fausses erreurs. Il
  n'a pas non plus les règles React (`eslint-plugin-react-hooks`).
- Aucun test ne couvre les cas du §3 : avoirs cumulés, retour partiel, paiement au mauvais
  client, droits sur la synchronisation, modification d'un super-administrateur.

---

## 6. 🟡 Problèmes mineurs (sélection)

- **Connexion :**
  - Une réponse plus rapide pour un nom d'utilisateur inconnu permet de deviner les noms
    existants (empreinte factice de 52 caractères au lieu de 60, `auth/application.ts:140`).
  - Un membre désactivé d'une société peut encore y accéder (`auth/repository.ts:51-58`).
  - Un rôle supprimé donne encore ses permissions.
- **Sessions :**
  - Les permissions sont copiées dans le jeton : un changement de rôle met jusqu'à
    15 minutes à s'appliquer.
  - Le jeton de renouvellement (valable 30 jours) est gardé dans `localStorage`.
- **Serveur :**
  - Pas de gestionnaire `unhandledRejection` / `uncaughtException`.
  - Corps de requête jusqu'à 10 Mo sur toutes les routes, lu avant la limitation de débit.
  - `x-request-id` accepté sans contrôle.
  - La politique de sécurité de contenu (CSP) est trop large.
- **Caisse :**
  - Un ticket peut être encaissé sur la session d'un autre caissier.
  - Le compteur de tickets est lu puis réécrit (perte possible avec deux ventes simultanées).
  - La fermeture ne verrouille pas la session.
- **Numérotation :**
  - Une facture antidatée casse l'ordre chronologique.
  - La date dépend du fuseau horaire du serveur : fixer `TZ=UTC`.
- **Produits archivés :** ils restent vendables.
- **Tauri :** la connexion hors ligne vérifie contre des données que la page web peut
  réécrire ; les empreintes sont stockées en clair dans SQLite.
- **Affichage :**
  - Axe du graphique en « 1,2 k » (abréviation).
  - Badges de stock sans mots (« 3 / 5 »).
  - L'éditeur de lignes fait 900 px de large minimum, ce qui oblige à défiler de côté sur
    téléphone.
- **Caisse :** le panier est perdu si la page se recharge.
- **Mots encore techniques :**
  - fr : « avoir » (17 textes), « Modules », « Journal » hors comptabilité, « Lot »,
    « Exporter », « Tableau de bord », « Le serveur… » ;
  - ar : « الوحدات », « الإشعارات الدائنة », « الخادم ».
- **Code mort :**
  - dossier `.vercel/output/` : ancien build avec les pages pièces auto (véhicules,
    fabricants…) ;
  - clés de traduction `nav:crumbs.vehicles/manufacturers/…` ;
  - champ `originCountry` sur les lignes ;
  - 8 composants d'interface jamais utilisés ;
  - feuille de style ArchitectUI/Bootstrap de 336 Ko chargée sur chaque page.

---

## 7. Ce qu'il faut ajouter

Chaque point ci-dessous a été vérifié comme absent dans le code.

**Pour les commerçants (priorité haute)**

1. **Impression du ticket de caisse** (papier 58/80 mm) et **partage par WhatsApp**. La
   caisse n'imprime rien aujourd'hui, alors que le module le promet.
2. **Carnet de dettes client** :
   - relevé par client ;
   - dette qui tient compte des avoirs et des paiements non rattachés ;
   - ancienneté des dettes.
3. **Retours et remboursements à la caisse**, avec sortie d'argent de la caisse.
4. **Entrées et sorties d'argent de caisse** : dépenses (loyer, électricité), argent
   retiré par le patron.
5. **Paiement en plusieurs moyens** à la caisse (espèces + Bankily), et **rendu de
   monnaie** avec raccourcis 500 / 1 000 / 2 000 MRU.
6. **Inventaire physique (comptage du stock)** : les tables `inventory_counts` existent,
   mais il n'y a ni écran ni route.
7. **Côté fournisseurs** : imputation des paiements, solde dû à chaque fournisseur,
   retours aux fournisseurs.
8. **Annulation** d'un paiement, d'une réception ou d'une facture fournisseur.
9. **Vraie marge** par produit (le coût des ventes est déjà enregistré dans
   `stock_movements`) et **rapport de fin de journée** de la caisse.
10. **Prix de gros / prix de détail**, et prix par variante.

**Pour l'exploitation (priorité haute)**

11. **Sauvegardes automatiques** de la base, avec un test de restauration. Aujourd'hui,
    seul un `pg_dump` manuel est documenté.
12. **Étape de migration au déploiement** (Docker et Vercel).
13. **Journal d'audit** : la table `audit_logs` existe mais n'est jamais remplie.
14. **Réinitialisation du mot de passe**, blocage après plusieurs échecs, et liste des
    sessions actives avec possibilité de les fermer.
15. **Suivi des erreurs en production** (Sentry ou équivalent) et une sonde `/api/health`
    qui vérifie aussi la base.
16. **Création d'une nouvelle société** sans passer par le script de démarrage.
17. **Export des données** (CSV / Excel) côté serveur.
18. **Clôture d'exercice** avec report des soldes.

---

## 8. Ce qu'il faut améliorer

- **Accueil simplifié pour le caissier** : trois gros boutons avec icônes (Vendre, Stock,
  Argent du jour). La comptabilité et les réglages vont derrière un mode « avancé ».
- **Champs de montant** : accepter les chiffres arabes et afficher la valeur comprise
  sous le champ (« = 1 500 MRU »).
- **Confirmations en mots simples, avec le montant.** Exemple : « Valider la facture de
  12 500 MRU ? Elle ne pourra plus être modifiée. »
- **Après une vente sans internet** : rester sur le document avec un badge clair
  « pas encore envoyé », au lieu d'envoyer l'utilisateur vers l'écran technique `/sync`.
- **Expliquer les boutons grisés** et afficher les erreurs à côté du champ concerné.
- **Poids de l'application** :
  - découper le fichier principal de 915 Ko ;
  - ne charger la feuille ArchitectUI que si elle est nécessaire ;
  - suspendre le préchargement quand le téléphone est en mode économie de données ou
    en 2G.
- **Affichage sur téléphone** : afficher les lignes de document en cartes, et vérifier
  la caisse sur un écran de 360 px (le bouton Payer peut sortir de l'écran).

---

## 9. Plan d'action proposé

**Étape 1 — Bloquant (avant toute vraie utilisation)**

1. Sécurité : §3.1, §3.2, §3.3, §3.4.
2. Argent :
   - §3.5 à §3.10 ;
   - avoirs cumulés et plafonnés par ligne vendue ;
   - retour partiel qui n'annule pas la facture ;
   - quantités et prix positifs ;
   - contrôle du client au paiement.
3. Hors ligne : §3.12 (ventes bloquées en « envoi en cours ») et §3.13 (écran blanc).
4. Remettre les tests au vert (§5) et ajouter un test pour chaque correction ci-dessus.

**Étape 2 — Avant l'ouverture à plusieurs boutiques**

5. Synchronisation : §4.1 à §4.6.
6. Migrations propres, avec migration au déploiement et sauvegardes automatiques
   (§4.9, §7.11, §7.12).
7. Passage des sommes en `bigint` (§4.18).
8. Paiements fournisseurs (§3.11) et avoirs dans la dette client (§3.8).
9. Service Worker (§4.22) et saisie des montants (§4.23, §4.24).

**Étape 3 — Confort et fonctionnalités**

10. Ticket de caisse, carnet de dettes, dépenses, inventaire physique, paiement en
    plusieurs moyens.
11. Rapports justes (§4.17), cohérence entre caisse/banque et comptabilité (§4.19),
    clôture d'exercice.
12. Améliorations d'interface du §8.

---

## Annexe — Refaire les tests localement

```bash
docker start erp-sahel-db        # base locale, port 5436
docker exec erp-sahel-db psql -U erp -c "CREATE DATABASE erp_sahel_review"
export DATABASE_URL=postgresql://erp:erp@localhost:5436/erp_sahel_review
export SEED_ADMIN_PASSWORD='Admin123!' JWT_SECRET=un-secret-de-test-d-au-moins-32-caracteres
npx tsx scripts/migrate.ts && npx tsx server/seed.ts
npm test                          # tests unitaires et d'intégration
npm run build && npm run test:e2e # tests navigateur (port 5100)
```

⚠️ Exportez toujours `DATABASE_URL` avant de lancer les tests. Sinon, le fichier `.env`
pointe vers la base **Neon distante**, et les tests d'intégration y créeraient des
sociétés de test.
