# Plan de test

`npm test` exécute l'ensemble : **80 tests**, unitaires et d'intégration.
`npm run test:e2e` ajoute le scénario end-to-end avec coupure réseau réelle.

---

## 1. Niveaux

| Niveau          | Portée                                                 | Emplacement                            |
| --------------- | ------------------------------------------------------ | -------------------------------------- |
| **Unitaire**    | Fonctions pures partagées : calculs, comptabilité, OEM | `shared/__tests__/`                    |
| **Intégration** | Cas d'usage complets sur PostgreSQL réel               | `server/__tests__/`                    |
| **Offline**     | File d'attente et instantané sur IndexedDB             | `client/src/shared/offline/__tests__/` |
| **End-to-end**  | Parcours utilisateur, réseau coupé                     | `e2e/`                                 |

Les tests d'intégration créent **leur propre société** : l'isolation multi-société sert de
mécanisme d'isolation des tests, ce qui vérifie l'invariant en même temps.

---

## 2. Couverture par exigence

### Calculs (`pricing.test.ts`, 12 tests)

- Arrondi symétrique autour de zéro
- Taux et remises en points de base, sans dérive flottante
- Saisie française (`1 250,50`, espace fine insécable comprise)
- **Somme des lignes = total du document** après répartition d'une remise globale
- TVA annulée pour une société non assujettie
- Ventilation de la TVA par taux
- Statut de règlement déduit des montants, jamais saisi

### Comptabilité (`accounting.test.ts`, 12 tests)

- Écritures de facture, d'avoir, de facture fournisseur, de règlement
- Avoir strictement miroir de la facture
- Ligne de TVA omise quand la société n'est pas assujettie
- Refus d'une écriture déséquilibrée
- Sens naturel des comptes, plans OHADA et PCG

### Références OEM (`oem.test.ts`, 7 tests)

- Normalisation (casse, espaces, tirets, points, slashes)
- **Transitivité quel que soit le point d'entrée** de la chaîne d'équivalences
- Symétrie : l'ordre de déclaration n'a pas d'incidence
- Détection des équivalences redondantes
- Borne de taille contre un graphe pathologique

### Chaîne métier (`business-flow.test.ts`, 15 tests)

- Brouillon sans effet : stock intact, pas de numéro légal
- Validation : numéro `FAC-AAAA-NNNN`, stock décrémenté, écriture équilibrée
- Facture validée **inaltérable**
- Refus de vendre au-delà du stock disponible
- Règlement : facture soldée, trésorerie alimentée, écriture passée
- Refus d'un règlement supérieur au reste à payer ; acompte ⇒ partiellement payée
- Avoir : stock réintégré, écriture inverse ; refus sur brouillon
- Devis → commande → facture sans perte de montant ; refus de double conversion
- Achat : commande → réception ⇒ entrée en stock, statut `RECEIVED`
- Caisse : ticket encaissé, session mise à jour, clôture sans écart
- Refus d'un encaissement qui ne couvre pas le total
- **Cohérence globale** : journal, grand livre et balance en accord

### Synchronisation hors ligne (`sync-idempotence.test.ts`, 6 tests)

Le test central du produit.

- Ingestion d'un lot complet, numéro légal attribué en remplacement du provisoire
- **Rejeu du même lot ⇒ `duplicate` sur toute la ligne**, mêmes identifiants renvoyés
- **Trois envois ⇒ une seule sortie de stock**
- Écritures équilibrées, aucune écriture dupliquée
- Dépendance non résolue ⇒ `deferred`, **rien n'est écrit**
- Référence créée dans le même lot correctement résolue

### Isolation et autorisations (`isolation-rbac.test.ts`, 11 tests)

- Catalogue invisible depuis une autre société, même en connaissant l'identifiant
- Impossible de facturer un tiers ou d'utiliser un produit d'une autre société
- Séquences de numérotation indépendantes par société
- Rôles par défaut : administrateur complet, vendeur sans comptabilité, consultation en
  lecture seule
- Module désactivé ⇒ profil produit refusé
- Compatibilité SemVer noyau ⇄ module

### File d'attente locale (`outbox.test.ts`, 9 tests)

- Identifiant d'idempotence et séquence croissante
- Identifiant fourni, pour lier une facture à son règlement
- **Persistance après réouverture de la base** (fermeture du navigateur)
- Ordre causal restitué, indépendamment de l'ordre d'écriture
- Acquittements : `synced` retire, `deferred` conserve, `error` compte les tentatives
- Purge automatique limitée aux opérations synchronisées anciennes
- Abandon d'une opération uniquement sur demande explicite

### Instantané hors ligne (`snapshot.test.ts`, 8 tests)

- Recherche par désignation et par référence interne
- **Recherche OEM avec fermeture transitive, sans réseau**
- Enrichissement fabricant / origine / qualité
- Agrégation du stock multi-magasins
- Résolution d'un code-barres scanné
- Recherche de tiers par nom, code ou téléphone

### End-to-end (`e2e/offline-pos.spec.ts`)

Reproduit le scénario du cahier des charges :

1. connexion et ouverture de caisse ;
2. **coupure réseau** (`context.setOffline`) ;
3. encaissement hors ligne, numéro provisoire affiché ;
4. rechargement de la page — la vente est toujours en file ;
5. **retour du réseau** → synchronisation, numéro légal ;
6. seconde synchronisation → **aucun doublon**.

Un second scénario vérifie que l'application s'ouvre sans réseau une fois la coquille mise
en cache par le Service Worker.

---

## 3. Exécution

```bash
npm test                 # suite complète
npm run test:watch       # mode surveillance
npm run test:e2e         # end-to-end (nécessite npm run build au préalable)
npm run quality          # typecheck + lint + tests
```

Les tests d'intégration ont besoin d'une base PostgreSQL accessible via `DATABASE_URL`.
Ils s'exécutent en série (`fileParallelism: false`) : ils partagent la base et se
marcheraient dessus en parallèle.

---

## 4. Ce qui n'est pas couvert automatiquement

À vérifier manuellement avant livraison :

- **Tests de charge** (10 / 50 / 100 utilisateurs simultanés) — outillage k6 ou Locust à
  brancher sur `/api/catalog/products` et `/api/sync/push`.
- **Recette utilisateur** par un tiers non-développeur : parcours client → produit →
  facture → règlement → clôture de caisse, sans explication à chaque étape.
- **Validation en conditions réelles sur 7 à 14 jours** : absence de perte de données,
  d'erreur comptable et d'anomalie de synchronisation.
- **Impression** des documents sur le matériel du client.
