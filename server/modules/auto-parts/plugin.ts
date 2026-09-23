/**
 * Module **Auto Parts** — implémentation du contrat `ErpPlugin`.
 *
 * Le noyau ne connaît de ce fichier que le contrat : il ignore ce qu'est une référence
 * OEM ou une motorisation. Toute la connaissance métier « pièces auto » est ici, ce qui
 * rend le module remplaçable et le noyau réutilisable pour d'autres domaines ([BR-15]).
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  autoPartProfiles,
  countries,
  oemEquivalences,
  partVehicleCompat,
  qualityLevels,
  type QualityCode,
} from "@shared/schema";
import type { Database } from "../../db";
import type { ErpPlugin } from "../../domains/plugins/contract";
import { autoPartsRepository, manufacturersRepository } from "./repository";

/** Référentiel des pays d'origine ([FR-FAB-2]), semé à l'installation du module. */
const COUNTRY_SEED: { code: string; name: string }[] = [
  { code: "JP", name: "Japon" },
  { code: "US", name: "États-Unis" },
  { code: "TW", name: "Taïwan" },
  { code: "KR", name: "Corée du Sud" },
  { code: "CN", name: "Chine" },
  { code: "TH", name: "Thaïlande" },
  { code: "DE", name: "Allemagne" },
  { code: "ID", name: "Indonésie" },
  { code: "FR", name: "France" },
  { code: "IN", name: "Inde" },
  { code: "TR", name: "Turquie" },
  { code: "ES", name: "Espagne" },
  { code: "IT", name: "Italie" },
  { code: "MA", name: "Maroc" },
  { code: "AE", name: "Émirats arabes unis" },
];

/** Niveaux de qualité ([FR-FAB-5]) ; `rank` pilote l'ordre d'affichage en recherche. */
const QUALITY_SEED: { code: QualityCode; label: string; rank: number }[] = [
  { code: "OEM", label: "Original (OEM)", rank: 1 },
  { code: "GENUINE", label: "Genuine", rank: 2 },
  { code: "PREMIUM", label: "Premium", rank: 3 },
  { code: "AFTERMARKET", label: "Aftermarket", rank: 4 },
  { code: "STANDARD", label: "Standard", rank: 5 },
  { code: "ECONOMIQUE", label: "Économique", rank: 6 },
];

/** Payload du profil produit accepté par le catalogue générique. */
const profileSchema = z.object({
  oemReference: z.string().max(64).default(""),
  manufacturerId: z.string().uuid().nullish(),
  countryId: z.string().uuid().nullish(),
  qualityLevelId: z.string().uuid().nullish(),
  manufacturerRef: z.string().max(64).default(""),
  warrantyMonths: z.number().int().min(0).max(240).default(0),
});

export const autoPartsPlugin: ErpPlugin = {
  meta: {
    code: "auto_parts",
    name: "Pièces détachées auto",
    description:
      "Références OEM, équivalences, fabricants, pays d'origine, qualité et compatibilité véhicule à quatre niveaux.",
    version: "1.0.0",
    coreVersion: "^1.0.0",
    dependencies: [],
    profileType: "AUTO_PARTS",
    icon: "IconCar",
  },

  permissions: ["auto_parts.read", "auto_parts.write"],

  navigation: [
    {
      title: "Pièces auto",
      href: "/modules/auto-parts",
      icon: "IconCar",
      permission: "auto_parts.read",
      items: [
        { title: "Recherche OEM", href: "/modules/auto-parts/search" },
        { title: "Équivalences", href: "/modules/auto-parts/equivalences" },
        { title: "Fabricants", href: "/modules/auto-parts/manufacturers" },
        { title: "Véhicules", href: "/modules/auto-parts/vehicles" },
      ],
    },
  ],

  searchCriteria: [
    { key: "oem", label: "Référence OEM", type: "text" },
    {
      key: "manufacturerId",
      label: "Fabricant",
      type: "select",
      optionsEndpoint: "/api/modules/auto-parts/manufacturers",
    },
    {
      key: "countryId",
      label: "Pays d'origine",
      type: "select",
      optionsEndpoint: "/api/modules/auto-parts/countries",
    },
    {
      key: "qualityLevelId",
      label: "Qualité",
      type: "select",
      optionsEndpoint: "/api/modules/auto-parts/quality-levels",
    },
    {
      key: "vehicleModelId",
      label: "Modèle véhicule",
      type: "select",
      optionsEndpoint: "/api/modules/auto-parts/vehicles",
    },
  ],

  productProfile: {
    profileType: "AUTO_PARTS",

    async load(database, companyId, productIds) {
      const rows = await autoPartsRepository
        .withTransaction(database)
        .loadProfiles(companyId, productIds);
      return new Map(
        rows.map((row) => [
          row.profile.productId,
          {
            ...row.profile,
            manufacturerName: row.manufacturerName,
            countryName: row.countryName,
            countryCode: row.countryCode,
            qualityLabel: row.qualityLabel,
          },
        ])
      );
    },

    async save(tx, companyId, productId, payload) {
      const data = profileSchema.parse(payload ?? {});
      await autoPartsRepository.withTransaction(tx).upsertProfile(companyId, productId, data);
    },

    async remove(tx, companyId, productId) {
      await autoPartsRepository.withTransaction(tx).deleteProfile(companyId, productId);
    },

    buildSearchFilter(companyId, query) {
      return autoPartsRepository.buildSearchFilter(companyId, query);
    },
  },

  /** Installation globale : référentiels partagés, idempotents ([FR-PLUG-6]). */
  async install(tx: Database) {
    for (const country of COUNTRY_SEED) {
      await tx.insert(countries).values(country).onConflictDoNothing();
    }
    for (const quality of QUALITY_SEED) {
      await tx.insert(qualityLevels).values(quality).onConflictDoNothing();
    }
  },

  /**
   * Données du module embarquées hors-ligne : sans les équivalences et les profils,
   * la recherche OEM du comptoir cesserait de fonctionner dès la coupure réseau.
   */
  async buildSnapshot(database: Database, companyId: string) {
    const repository = autoPartsRepository.withTransaction(database);
    const [
      profiles,
      equivalences,
      compatibilities,
      countryRows,
      qualityRows,
      vehicleTree,
      manufacturerRows,
    ] = await Promise.all([
      database
        .select({
          productId: autoPartProfiles.productId,
          oemReference: autoPartProfiles.oemReference,
          oemNormalized: autoPartProfiles.oemNormalized,
          manufacturerId: autoPartProfiles.manufacturerId,
          countryId: autoPartProfiles.countryId,
          qualityLevelId: autoPartProfiles.qualityLevelId,
          manufacturerRef: autoPartProfiles.manufacturerRef,
          warrantyMonths: autoPartProfiles.warrantyMonths,
        })
        .from(autoPartProfiles)
        .where(eq(autoPartProfiles.companyId, companyId)),
      database
        .select({ normA: oemEquivalences.normA, normB: oemEquivalences.normB })
        .from(oemEquivalences)
        .where(sql`${oemEquivalences.companyId} = ${companyId} and ${oemEquivalences.isActive}`),
      database
        .select({
          productId: partVehicleCompat.productId,
          modelId: partVehicleCompat.modelId,
          generationId: partVehicleCompat.generationId,
          engineId: partVehicleCompat.engineId,
        })
        .from(partVehicleCompat)
        .where(
          sql`${partVehicleCompat.companyId} = ${companyId} and ${partVehicleCompat.isActive}`
        ),
      repository.listCountries(),
      repository.listQualityLevels(),
      repository.vehicleTree(companyId),
      manufacturersRepository.withTransaction(database).listAll(companyId),
    ]);

    return {
      profiles,
      equivalences,
      compatibilities,
      countries: countryRows,
      qualityLevels: qualityRows,
      manufacturers: manufacturerRows,
      vehicles: vehicleTree,
    };
  },
};
