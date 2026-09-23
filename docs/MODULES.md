# Modules métier

Un seul code source dessert plusieurs domaines. Le **noyau** (tiers, catalogue, achats,
stock, ventes, caisse, règlements, comptabilité, synchronisation) est commun ; chaque
domaine ajoute ce que le noyau ne peut pas deviner, sous forme de **module activable par
société**.

---

## 1. Ce que le noyau garantit

- Le noyau **n'importe jamais** un module. La dépendance est strictement `module → noyau`,
  vérifiée au lint (`no-restricted-imports` sur `server/domains/**`).
- Un module possède **son** modèle de données, **ses** permissions, **ses** routes et
  **son** interface. Aucune table du noyau n'est modifiée par un module.
- Un module désactivé est **inaccessible** : ses endpoints répondent 403 (`requireModule`)
  et ses écrans ne sont pas montés.
- Ajouter un domaine ne demande aucune modification du noyau ni des autres modules.

---

## 2. Modules livrés

### Pièces auto (`auto_parts`)

Le module de référence, qui pilote les exigences les plus fortes.

| Concept                      | Traitement                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Référence OEM**            | Attribut **indexé, non unique** : plusieurs articles distincts peuvent partager la même OEM, chacun avec son prix, son stock, son fabricant et son historique |
| **Équivalences**             | Relation **symétrique et transitive** ; rechercher `90915-10004` retrouve toute la classe, quel que soit le point d'entrée                                    |
| **Normalisation**            | Casse, espaces, tirets, points et slashes ignorés : `90915-YZZD3`, `90915 yzzd3` et `90915.YZZD3` se rapprochent                                              |
| **Fabricants**               | Table propre, distincte des marques de véhicules                                                                                                              |
| **Pays d'origine / qualité** | Référentiels globaux partagés, affichés en recherche et sur les documents                                                                                     |
| **Compatibilité véhicule**   | N–N sur 4 niveaux (marque → modèle → génération → motorisation) ; une pièce déclarée au niveau modèle reste compatible avec toutes ses générations            |

La recherche OEM fonctionne **hors ligne** : profils et arêtes d'équivalence sont embarqués
dans l'instantané, et la fermeture transitive est calculée par la même fonction partagée
(`shared/oem.ts`) que côté serveur.

### Vêtements (`clothing`)

Profil vêtement (marque, genre, saison, matière, collection) et grilles de tailles. Les
déclinaisons **taille × couleur** sont générées comme `product_variants` du noyau : chaque
combinaison a son code-barres et son stock, sans aucune table de stock supplémentaire.

### Marché (`market`)

Profil marchandise (marque, poids, volume, unité de mesure, catégorie de taxe) et gestion
optionnelle des **lots datés**. La péremption réutilise les lots du noyau
(`stock_items.lot_number`) ; le module n'ajoute que la DLC et les alertes.

---

## 3. Le contrat

```ts
// server/domains/plugins/contract.ts
interface ErpPlugin {
  meta: {
    code: ModuleCode; // identifiant stable
    name;
    description: string;
    version: string; // SemVer du module
    coreVersion: string; // plage de noyau supportée, ex. "^1.0.0"
    dependencies: ModuleCode[];
    profileType: ProfileType; // type de profil produit servi
    icon: string;
  };

  permissions: PermissionCode[]; // contribuées au RBAC
  navigation: PluginNavItem[]; // entrées de menu, avec leur permission
  searchCriteria: SearchCriterion[]; // filtres ajoutés au catalogue

  productProfile?: {
    profileType: ProfileType;
    load(db, companyId, productIds): Promise<Map<string, unknown>>;
    save(tx, companyId, productId, payload): Promise<void>;
    remove?(tx, companyId, productId): Promise<void>;
    buildSearchFilter?(companyId, query): SQL | undefined;
  };

  buildSnapshot?(db, companyId): Promise<Record<string, unknown>>; // données hors ligne

  install?(tx): Promise<void>; // global, idempotent
  enable?(tx, companyId): Promise<void>; // par société, idempotent
  disable?(tx, companyId): Promise<void>; // masque, ne supprime rien
}
```

### Points d'extension expliqués

**`productProfile`** — le catalogue du noyau est générique (`Product`, `ProductVariant`).
Un module l'étend par un profil **1–1**, stocké dans ses propres tables. Le formulaire
produit affiche le bloc correspondant au module choisi ; le noyau ignore ce qu'il contient.

**`buildSearchFilter`** — reçoit les paramètres de requête non consommés par le noyau et
renvoie une condition sur `products.id`. Les filtres de plusieurs modules se **cumulent** :
un produit doit satisfaire tous les critères saisis.

**`buildSnapshot`** — sans lui, la recherche par OEM ou par taille cesserait de fonctionner
dès la coupure réseau. Le volume doit rester borné : c'est un cache de poste, pas une
réplication.

**Cycle de vie** — `install` sème les référentiels globaux (pays, niveaux de qualité) ;
`enable` prépare la société (grilles de tailles par défaut). Les deux sont **idempotents** :
ils sont rejoués à chaque démarrage sans effet de bord.

---

## 4. Ajouter un module

Exemple : un module « Pharmacie ».

**1. Schéma** — `shared/schema/modules/pharmacy.ts`, tables préfixées `ph_`, réexportées
depuis `shared/schema/index.ts`.

```ts
export const pharmacyProfiles = pgTable("ph_profiles", {
  ...baseColumns,
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  dci: text("dci").default("").notNull(),
  requiresPrescription: boolean("requires_prescription").default(false).notNull(),
});
```

**2. Code du module** — `server/modules/pharmacy/{plugin,repository,routes}.ts`. Le
`plugin.ts` implémente `ErpPlugin`.

**3. Permissions** — ajouter `pharmacy.read` / `pharmacy.write` à `shared/rbac.ts` et
déclarer le nouveau `ModuleCode` dans `shared/schema/plugins.ts`.

**4. Branchement** — deux lignes dans `server/modules/index.ts` :

```ts
pluginRegistry.register(pharmacyPlugin);
registerPharmacyRoutes(app);
```

**5. Interface** — ajouter l'entrée dans `client/src/shared/config/nav.ts` (avec son
`module` et sa `permission`), et le bloc de profil dans le formulaire produit.

**6. Migration** — `npm run db:generate` puis `npm run db:migrate`.

Aucun fichier du noyau n'est modifié en dehors des points de composition explicitement
prévus pour cela.

---

## 5. Compatibilité de versions

Chaque module déclare la plage de noyau qu'il supporte (`coreVersion`, par exemple
`"^1.0.0"`). L'enregistrement échoue au démarrage si la version du noyau n'est pas
satisfaite — un module incompatible ne se charge pas à moitié.

Les dépendances entre modules sont vérifiées à l'activation : activer un module exige que
ses dépendances soient déjà actives ; le désactiver est refusé tant qu'un module dépendant
l'utilise.

---

## 6. Activation par société

`company_plugins` porte l'état par société. Une société active **un ou plusieurs** modules
— il n'existe pas de « type d'activité » exclusif. Une même société peut donc vendre des
pièces auto et des vêtements, avec un catalogue unique et deux profils produit distincts.

L'activation se pilote depuis **Paramètres › Modules** et prend effet immédiatement :
navigation, formulaires et endpoints suivent, sans redéploiement.
