/**
 * Persistance du module Auto Parts.
 *
 * Aucune table du noyau n'est modifiée ([BR-15]) : ce repository ne touche que les
 * tables `ap_*`, et ne rejoint `products` qu'en lecture pour composer les résultats
 * de recherche.
 */

import { and, asc, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { canonicalPair, normalizeOem, resolveEquivalents } from "@shared/oem";
import {
  autoPartProfiles,
  countries,
  manufacturers,
  oemEquivalences,
  partVehicleCompat,
  products,
  qualityLevels,
  vehicleBrands,
  vehicleEngines,
  vehicleGenerations,
  vehicleModels,
  type AutoPartProfile,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const manufacturersRepository = new TenantRepository(manufacturers, [manufacturers.name]);
export const vehicleBrandsRepository = new TenantRepository(vehicleBrands, [vehicleBrands.name]);
export const vehicleModelsRepository = new TenantRepository(vehicleModels, [vehicleModels.name]);
export const vehicleGenerationsRepository = new TenantRepository(vehicleGenerations, [
  vehicleGenerations.name,
]);
export const vehicleEnginesRepository = new TenantRepository(vehicleEngines, [
  vehicleEngines.code,
  vehicleEngines.label,
]);
export const oemEquivalencesRepository = new TenantRepository(oemEquivalences, [
  oemEquivalences.refA,
  oemEquivalences.refB,
]);
export const partCompatRepository = new TenantRepository(partVehicleCompat, []);

export class AutoPartsRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): AutoPartsRepository {
    return new AutoPartsRepository(tx);
  }

  /** Référentiels globaux, partagés par toutes les sociétés. */
  async listCountries() {
    return this.database.select().from(countries).orderBy(asc(countries.name));
  }

  async listQualityLevels() {
    return this.database.select().from(qualityLevels).orderBy(asc(qualityLevels.rank));
  }

  async findProfile(companyId: string, productId: string): Promise<AutoPartProfile | null> {
    const [row] = await this.database
      .select()
      .from(autoPartProfiles)
      .where(
        and(eq(autoPartProfiles.companyId, companyId), eq(autoPartProfiles.productId, productId))
      )
      .limit(1);
    return row ?? null;
  }

  async loadProfiles(companyId: string, productIds: string[]) {
    if (productIds.length === 0) return [];
    return this.database
      .select({
        profile: autoPartProfiles,
        manufacturerName: manufacturers.name,
        countryName: countries.name,
        countryCode: countries.code,
        qualityLabel: qualityLevels.label,
      })
      .from(autoPartProfiles)
      .leftJoin(manufacturers, eq(manufacturers.id, autoPartProfiles.manufacturerId))
      .leftJoin(countries, eq(countries.id, autoPartProfiles.countryId))
      .leftJoin(qualityLevels, eq(qualityLevels.id, autoPartProfiles.qualityLevelId))
      .where(
        and(
          eq(autoPartProfiles.companyId, companyId),
          inArray(autoPartProfiles.productId, productIds)
        )
      );
  }

  /** Crée ou met à jour le profil 1–1 d'un produit. */
  async upsertProfile(
    companyId: string,
    productId: string,
    values: {
      oemReference?: string;
      manufacturerId?: string | null;
      countryId?: string | null;
      qualityLevelId?: string | null;
      manufacturerRef?: string;
      warrantyMonths?: number;
    }
  ): Promise<AutoPartProfile> {
    const oemReference = values.oemReference ?? "";
    const [row] = await this.database
      .insert(autoPartProfiles)
      .values({
        companyId,
        productId,
        oemReference,
        oemNormalized: normalizeOem(oemReference),
        manufacturerId: values.manufacturerId ?? null,
        countryId: values.countryId ?? null,
        qualityLevelId: values.qualityLevelId ?? null,
        manufacturerRef: values.manufacturerRef ?? "",
        warrantyMonths: values.warrantyMonths ?? 0,
      })
      .onConflictDoUpdate({
        target: autoPartProfiles.productId,
        set: {
          oemReference,
          oemNormalized: normalizeOem(oemReference),
          manufacturerId: values.manufacturerId ?? null,
          countryId: values.countryId ?? null,
          qualityLevelId: values.qualityLevelId ?? null,
          manufacturerRef: values.manufacturerRef ?? "",
          warrantyMonths: values.warrantyMonths ?? 0,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async deleteProfile(companyId: string, productId: string): Promise<void> {
    await this.database
      .delete(autoPartProfiles)
      .where(
        and(eq(autoPartProfiles.companyId, companyId), eq(autoPartProfiles.productId, productId))
      );
  }

  /** Arêtes d'équivalence de la société — base du calcul de fermeture transitive. */
  async listEquivalenceEdges(companyId: string) {
    return this.database
      .select({ normA: oemEquivalences.normA, normB: oemEquivalences.normB })
      .from(oemEquivalences)
      .where(and(eq(oemEquivalences.companyId, companyId), eq(oemEquivalences.isActive, true)));
  }

  async listEquivalences(companyId: string, reference?: string) {
    const normalized = reference ? normalizeOem(reference) : null;
    return this.database
      .select()
      .from(oemEquivalences)
      .where(
        and(
          eq(oemEquivalences.companyId, companyId),
          eq(oemEquivalences.isActive, true),
          normalized
            ? or(eq(oemEquivalences.normA, normalized), eq(oemEquivalences.normB, normalized))
            : undefined
        )
      )
      .orderBy(asc(oemEquivalences.refA));
  }

  async insertEquivalence(
    companyId: string,
    values: { refA: string; refB: string; relationType?: string; source?: string; note?: string }
  ) {
    const { normA, normB } = canonicalPair(values.refA, values.refB);
    const [row] = await this.database
      .insert(oemEquivalences)
      .values({
        companyId,
        refA: values.refA.trim(),
        refB: values.refB.trim(),
        normA,
        normB,
        relationType: (values.relationType ?? "OEM_OEM") as "OEM_OEM" | "OEM_AFTERMARKET",
        source: values.source ?? "",
        note: values.note ?? "",
      })
      .onConflictDoUpdate({
        target: [oemEquivalences.companyId, oemEquivalences.normA, oemEquivalences.normB],
        set: { isActive: true, note: values.note ?? "", updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  /**
   * Recherche par OEM **avec équivalences** ([FR-SRCH-2], [FR-SRCH-3]) : renvoie tous
   * les articles partageant la référence ou l'une de ses équivalentes, avec fabricant,
   * origine, prix et qualité — les colonnes exigées par le cahier des charges.
   */
  async searchByOem(companyId: string, reference: string) {
    const edges = await this.listEquivalenceEdges(companyId);
    const classMembers = resolveEquivalents(reference, edges);
    if (classMembers.length === 0) return { equivalents: [], items: [] };

    const rows = await this.database
      .select({
        product: products,
        profile: autoPartProfiles,
        manufacturerName: manufacturers.name,
        countryName: countries.name,
        countryCode: countries.code,
        qualityLabel: qualityLevels.label,
        qualityRank: qualityLevels.rank,
      })
      .from(autoPartProfiles)
      .innerJoin(products, eq(products.id, autoPartProfiles.productId))
      .leftJoin(manufacturers, eq(manufacturers.id, autoPartProfiles.manufacturerId))
      .leftJoin(countries, eq(countries.id, autoPartProfiles.countryId))
      .leftJoin(qualityLevels, eq(qualityLevels.id, autoPartProfiles.qualityLevelId))
      .where(
        and(
          eq(autoPartProfiles.companyId, companyId),
          eq(products.isActive, true),
          inArray(autoPartProfiles.oemNormalized, classMembers)
        )
      )
      .orderBy(asc(qualityLevels.rank), asc(products.salePriceCents));

    return { equivalents: classMembers, items: rows };
  }

  /**
   * Condition restreignant `products.id` aux produits satisfaisant les critères
   * Auto Parts. Utilisée comme filtre composable par la recherche du catalogue.
   */
  buildSearchFilter(companyId: string, query: Record<string, unknown>): SQL | undefined {
    const conditions: (SQL | undefined)[] = [];

    const oem = typeof query.oem === "string" ? query.oem.trim() : "";
    if (oem) conditions.push(eq(autoPartProfiles.oemNormalized, normalizeOem(oem)));
    if (typeof query.manufacturerId === "string" && query.manufacturerId) {
      conditions.push(eq(autoPartProfiles.manufacturerId, query.manufacturerId));
    }
    if (typeof query.countryId === "string" && query.countryId) {
      conditions.push(eq(autoPartProfiles.countryId, query.countryId));
    }
    if (typeof query.qualityLevelId === "string" && query.qualityLevelId) {
      conditions.push(eq(autoPartProfiles.qualityLevelId, query.qualityLevelId));
    }
    if (
      conditions.length === 0 &&
      !query.vehicleModelId &&
      !query.vehicleGenerationId &&
      !query.vehicleEngineId
    ) {
      return undefined;
    }

    const profileFilter =
      conditions.length > 0
        ? exists(
            this.database
              .select({ one: sql`1` })
              .from(autoPartProfiles)
              .where(
                and(
                  eq(autoPartProfiles.companyId, companyId),
                  eq(autoPartProfiles.productId, products.id),
                  ...conditions.filter(Boolean)
                )
              )
          )
        : undefined;

    const vehicleFilter = this.buildVehicleFilter(companyId, query);
    return and(...[profileFilter, vehicleFilter].filter(Boolean));
  }

  /**
   * Compatibilité véhicule : une pièce déclarée au niveau **modèle** reste compatible
   * avec toutes ses générations et motorisations ([BR-4]). Le filtre remonte donc la
   * hiérarchie plutôt que d'exiger une correspondance exacte.
   */
  private buildVehicleFilter(companyId: string, query: Record<string, unknown>): SQL | undefined {
    const engineId = typeof query.vehicleEngineId === "string" ? query.vehicleEngineId : null;
    const generationId =
      typeof query.vehicleGenerationId === "string" ? query.vehicleGenerationId : null;
    const modelId = typeof query.vehicleModelId === "string" ? query.vehicleModelId : null;
    if (!engineId && !generationId && !modelId) return undefined;

    const target: (SQL | undefined)[] = [];
    if (engineId) {
      target.push(
        or(
          eq(partVehicleCompat.engineId, engineId),
          and(isNull(partVehicleCompat.engineId), isNull(partVehicleCompat.generationId))
        )
      );
    }
    if (generationId) {
      target.push(
        or(eq(partVehicleCompat.generationId, generationId), isNull(partVehicleCompat.generationId))
      );
    }
    if (modelId) target.push(eq(partVehicleCompat.modelId, modelId));

    return exists(
      this.database
        .select({ one: sql`1` })
        .from(partVehicleCompat)
        .where(
          and(
            eq(partVehicleCompat.companyId, companyId),
            eq(partVehicleCompat.productId, products.id),
            ...target.filter(Boolean)
          )
        )
    );
  }

  /** Hiérarchie véhicule complète — alimente les sélecteurs en cascade de l'UI. */
  async vehicleTree(companyId: string) {
    const [brands, models, generations, engines] = await Promise.all([
      this.database
        .select()
        .from(vehicleBrands)
        .where(and(eq(vehicleBrands.companyId, companyId), eq(vehicleBrands.isActive, true)))
        .orderBy(asc(vehicleBrands.name)),
      this.database
        .select()
        .from(vehicleModels)
        .where(and(eq(vehicleModels.companyId, companyId), eq(vehicleModels.isActive, true)))
        .orderBy(asc(vehicleModels.name)),
      this.database
        .select()
        .from(vehicleGenerations)
        .where(
          and(eq(vehicleGenerations.companyId, companyId), eq(vehicleGenerations.isActive, true))
        )
        .orderBy(asc(vehicleGenerations.yearStart)),
      this.database
        .select()
        .from(vehicleEngines)
        .where(and(eq(vehicleEngines.companyId, companyId), eq(vehicleEngines.isActive, true)))
        .orderBy(asc(vehicleEngines.code)),
    ]);
    return { brands, models, generations, engines };
  }

  async listCompatibilities(companyId: string, productId: string) {
    return this.database
      .select({
        compat: partVehicleCompat,
        brandName: vehicleBrands.name,
        modelName: vehicleModels.name,
        generationName: vehicleGenerations.name,
        engineCode: vehicleEngines.code,
      })
      .from(partVehicleCompat)
      .innerJoin(vehicleModels, eq(vehicleModels.id, partVehicleCompat.modelId))
      .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleModels.brandId))
      .leftJoin(vehicleGenerations, eq(vehicleGenerations.id, partVehicleCompat.generationId))
      .leftJoin(vehicleEngines, eq(vehicleEngines.id, partVehicleCompat.engineId))
      .where(
        and(
          eq(partVehicleCompat.companyId, companyId),
          eq(partVehicleCompat.productId, productId),
          eq(partVehicleCompat.isActive, true)
        )
      );
  }
}

export const autoPartsRepository = new AutoPartsRepository();
