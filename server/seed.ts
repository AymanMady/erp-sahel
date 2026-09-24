/**
 * Amorçage de la base : référentiels obligatoires puis jeu de démonstration.
 *
 * Deux étages, volontairement séparés :
 *  1. `seedCore()` — **indispensable en production** : permissions, rôles système,
 *     société, compte administrateur, plan comptable. Idempotent.
 *  2. `seedDemo()` — jeu de démonstration (catalogue, tiers, ventes, caisse). Ne
 *     s'exécute que si la société est vide, pour ne jamais polluer des données réelles.
 *
 * Usage : `npm run db:seed` (cœur + démo) · `npm run db:seed -- --core-only`.
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";

import { computeDocumentTotals } from "@shared/pricing";
import { todayInput, addDays } from "@shared/format";
import {
  ALL_PERMISSION_CODES,
  DEFAULT_ROLES,
  PERMISSIONS,
  resolveRolePermissions,
} from "@shared/rbac";
import { slugify } from "@shared/format";
import {
  bankAccounts,
  categories,
  manufacturers,
  partVehicleCompat,
  parties,
  permissions as permissionsTable,
  posRegisters,
  products,
  rolePermissions,
  roles,
  services,
  userCompanies,
  userRoles,
  users,
  vehicleBrands,
  vehicleEngines,
  vehicleGenerations,
  vehicleModels,
  warehouses,
  type Company,
  type QualityCode,
} from "@shared/schema";
import { closeDatabase, db } from "./db";
import { hashPassword } from "./domains/auth/application";
import { autoPartsRepository } from "./modules/auto-parts/repository";
import { catalogApplication } from "./domains/catalog/application";
import { invoicingApplication } from "./domains/invoicing/application";
import { paymentsApplication } from "./domains/payments/application";
import { pluginRegistry } from "./domains/plugins/registry";
import { posApplication } from "./domains/pos/application";
import { registerPlugins } from "./modules";
import { salesApplication } from "./domains/sales/application";
import { tenancyApplication } from "./domains/tenancy/application";
import { logger } from "./shared/logging/logger";

/** Permissions et rôles système — partagés par toutes les sociétés. */
async function seedPermissionsAndRoles(): Promise<void> {
  for (const code of ALL_PERMISSION_CODES) {
    await db
      .insert(permissionsTable)
      .values({
        code,
        label: PERMISSIONS[code],
        moduleCode: code.split(".")[0].includes("_") ? code.split(".")[0] : "core",
      })
      .onConflictDoUpdate({
        target: permissionsTable.code,
        set: { label: PERMISSIONS[code], updatedAt: new Date() },
      });
  }

  for (const preset of DEFAULT_ROLES) {
    const [role] = await db
      .insert(roles)
      .values({
        companyId: null,
        name: preset.name,
        slug: preset.slug,
        description: preset.description,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: roles.slug,
        targetWhere: sql`${roles.companyId} is null`,
        set: { name: preset.name, description: preset.description, updatedAt: new Date() },
      })
      .returning();

    const codes = resolveRolePermissions(preset.permissions);
    const permissionRows = await db
      .select({ id: permissionsTable.id, code: permissionsTable.code })
      .from(permissionsTable);
    const wanted = permissionRows.filter((row) => codes.includes(row.code as never));

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    if (wanted.length > 0) {
      await db
        .insert(rolePermissions)
        .values(wanted.map((row) => ({ roleId: role.id, permissionId: row.id })))
        .onConflictDoNothing();
    }
  }
  logger.info("Permissions et rôles système semés", {
    permissions: ALL_PERMISSION_CODES.length,
    roles: DEFAULT_ROLES.length,
  });
}

/** Société de travail : celle décrite par l'environnement, créée si absente. */
async function seedCompany(): Promise<Company> {
  const subdomain = slugify(process.env.SEED_COMPANY_SUBDOMAIN ?? "sahel");
  const existing = await tenancyApplication.findBySubdomain(subdomain);
  if (existing) return existing;

  const company = await tenancyApplication.create({
    name: process.env.SEED_COMPANY_NAME ?? "Sahel Pièces Auto",
    subdomain,
    legalName: process.env.SEED_COMPANY_NAME ?? "Sahel Pièces Auto SARL",
    currency: "MRU",
    language: "fr",
    accountingStandard: "OHADA",
    vatEnabled: true,
    defaultVatRateBp: 1600,
    city: "Nouakchott",
    country: "Mauritanie",
    primaryModule: "auto_parts",
  });
  logger.info("Société créée", { name: company.name, subdomain: company.subdomain });
  return company;
}

/** Compte administrateur initial, rattaché à la société avec le rôle Administrateur. */
async function seedAdminUser(company: Company): Promise<string> {
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin123!";

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  const user =
    existing ??
    (
      await db
        .insert(users)
        .values({
          username,
          passwordHash: await hashPassword(password),
          email: `${username}@example.com`,
          firstName: "Administrateur",
          lastName: "",
          isSuperuser: true,
        })
        .returning()
    )[0];

  await db
    .insert(userCompanies)
    .values({ userId: user.id, companyId: company.id, isDefault: true })
    .onConflictDoNothing();

  const [adminRole] = await db
    .select()
    .from(roles)
    .where(sql`${roles.slug} = 'administrateur' and ${roles.companyId} is null`)
    .limit(1);
  if (adminRole) {
    await db
      .insert(userRoles)
      .values({ userId: user.id, roleId: adminRole.id, companyId: company.id })
      .onConflictDoNothing();
  }

  if (!existing) {
    logger.info("Compte administrateur créé", { username, password });
  }
  return user.id;
}

/** Vrai si la société ne contient encore aucun produit : la démo peut s'installer. */
async function isCompanyEmpty(companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.companyId, companyId));
  return (row?.value ?? 0) === 0;
}

const MANUFACTURERS = [
  { name: "Toyota Genuine", country: "JP" },
  { name: "Bosch", country: "DE" },
  { name: "Denso", country: "JP" },
  { name: "NGK", country: "JP" },
  { name: "SKF", country: "DE" },
  { name: "KYB", country: "JP" },
  { name: "Aisin", country: "JP" },
  { name: "Febi Bilstein", country: "DE" },
];

const VEHICLES = [
  {
    brand: "Toyota",
    models: [
      {
        name: "Hilux",
        generations: [
          { name: "AN120", yearStart: 2016, yearEnd: 2020, engines: ["2GD-FTV", "1GD-FTV"] },
          { name: "AN130", yearStart: 2021, yearEnd: null, engines: ["2GD-FTV"] },
        ],
      },
      {
        name: "Land Cruiser",
        generations: [
          { name: "J150", yearStart: 2009, yearEnd: 2023, engines: ["1GD-FTV", "2TR-FE"] },
        ],
      },
    ],
  },
  {
    brand: "Nissan",
    models: [
      {
        name: "Navara",
        generations: [{ name: "D23", yearStart: 2014, yearEnd: null, engines: ["YS23DDTT"] }],
      },
    ],
  },
  {
    brand: "Hyundai",
    models: [
      {
        name: "H1",
        generations: [{ name: "TQ", yearStart: 2007, yearEnd: 2021, engines: ["D4CB"] }],
      },
    ],
  },
];

/**
 * Catalogue de démonstration.
 * Le premier bloc illustre **[BR-2]** : trois articles distincts partagent la même
 * référence OEM `90915-YZZD3` avec des fabricants, origines, prix et qualités différents.
 */
const AUTO_PARTS_DEMO: {
  sku: string;
  name: string;
  oem: string;
  manufacturer: string;
  country: string;
  quality: QualityCode;
  purchase: number;
  sale: number;
  stock: number;
}[] = [
  {
    sku: "FH-TOY-001",
    name: "Filtre à huile Hilux 2.4D",
    oem: "90915-YZZD3",
    manufacturer: "Toyota Genuine",
    country: "JP",
    quality: "OEM",
    purchase: 32000,
    sale: 52000,
    stock: 24,
  },
  {
    sku: "FH-DEN-001",
    name: "Filtre à huile Hilux 2.4D (Denso)",
    oem: "90915-YZZD3",
    manufacturer: "Denso",
    country: "TH",
    quality: "PREMIUM",
    purchase: 21000,
    sale: 36000,
    stock: 40,
  },
  {
    sku: "FH-BOS-001",
    name: "Filtre à huile Hilux 2.4D (Bosch)",
    oem: "90915-YZZD3",
    manufacturer: "Bosch",
    country: "DE",
    quality: "AFTERMARKET",
    purchase: 15000,
    sale: 27000,
    stock: 60,
  },
  {
    sku: "PLG-NGK-002",
    name: "Bougie d'allumage iridium",
    oem: "90919-01253",
    manufacturer: "NGK",
    country: "JP",
    quality: "PREMIUM",
    purchase: 9000,
    sale: 16500,
    stock: 120,
  },
  {
    sku: "AMO-KYB-010",
    name: "Amortisseur avant Hilux",
    oem: "48510-0K640",
    manufacturer: "KYB",
    country: "JP",
    quality: "OEM",
    purchase: 145000,
    sale: 225000,
    stock: 12,
  },
  {
    sku: "ROU-SKF-004",
    name: "Roulement de roue avant",
    oem: "90369-T0003",
    manufacturer: "SKF",
    country: "DE",
    quality: "PREMIUM",
    purchase: 68000,
    sale: 112000,
    stock: 18,
  },
  {
    sku: "PLQ-FEB-021",
    name: "Plaquettes de frein avant",
    oem: "04465-0K260",
    manufacturer: "Febi Bilstein",
    country: "DE",
    quality: "AFTERMARKET",
    purchase: 42000,
    sale: 75000,
    stock: 30,
  },
  {
    sku: "EMB-AIS-007",
    name: "Kit d'embrayage complet",
    oem: "31250-0K240",
    manufacturer: "Aisin",
    country: "JP",
    quality: "OEM",
    purchase: 380000,
    sale: 590000,
    stock: 6,
  },
];

/** Équivalences constructeur du cahier des charges ([FR-XREF-1]). */
const EQUIVALENCES = [
  { refA: "90915-10004", refB: "90915-YZZD3" },
  { refA: "90915-YZZD3", refB: "90915-YZZE1" },
  { refA: "90915-YZZE1", refB: "90915-30002" },
  { refA: "04465-0K260", refB: "04465-YZZQ7" },
];

async function seedDemoData(company: Company, userId: string): Promise<void> {
  const warehouse = (
    await db.select().from(warehouses).where(eq(warehouses.companyId, company.id)).limit(1)
  )[0];
  if (!warehouse) throw new Error("Magasin par défaut absent : amorçage société incomplet.");

  // --- Référentiels Auto Parts --------------------------------------------
  const countryRows = await autoPartsRepository.listCountries();
  const qualityRows = await autoPartsRepository.listQualityLevels();
  const countryByCode = new Map(countryRows.map((row) => [row.code, row.id]));
  const qualityByCode = new Map(qualityRows.map((row) => [row.code, row.id]));

  const manufacturerIds = new Map<string, string>();
  for (const entry of MANUFACTURERS) {
    const [row] = await db
      .insert(manufacturers)
      .values({
        companyId: company.id,
        name: entry.name,
        countryId: countryByCode.get(entry.country) ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) manufacturerIds.set(entry.name, row.id);
  }

  for (const brandEntry of VEHICLES) {
    const [brand] = await db
      .insert(vehicleBrands)
      .values({ companyId: company.id, name: brandEntry.brand })
      .onConflictDoNothing()
      .returning();
    if (!brand) continue;
    for (const modelEntry of brandEntry.models) {
      const [model] = await db
        .insert(vehicleModels)
        .values({ companyId: company.id, brandId: brand.id, name: modelEntry.name })
        .onConflictDoNothing()
        .returning();
      if (!model) continue;
      for (const generationEntry of modelEntry.generations) {
        const [generation] = await db
          .insert(vehicleGenerations)
          .values({
            companyId: company.id,
            modelId: model.id,
            name: generationEntry.name,
            yearStart: generationEntry.yearStart,
            yearEnd: generationEntry.yearEnd,
          })
          .onConflictDoNothing()
          .returning();
        if (!generation) continue;
        for (const engineCode of generationEntry.engines) {
          await db
            .insert(vehicleEngines)
            .values({
              companyId: company.id,
              generationId: generation.id,
              code: engineCode,
              label: engineCode,
              fuel: engineCode.includes("TR") ? "ESSENCE" : "DIESEL",
            })
            .onConflictDoNothing();
        }
      }
    }
  }

  for (const equivalence of EQUIVALENCES) {
    await autoPartsRepository.insertEquivalence(company.id, {
      ...equivalence,
      source: "Catalogue constructeur",
    });
  }

  // --- Catégories ----------------------------------------------------------
  const categoryNames = ["Filtration", "Freinage", "Suspension", "Moteur", "Transmission"];
  const categoryIds = new Map<string, string>();
  for (const name of categoryNames) {
    const [row] = await db.insert(categories).values({ companyId: company.id, name }).returning();
    if (row) categoryIds.set(name, row.id);
  }

  const categoryFor = (sku: string): string | null => {
    if (sku.startsWith("FH")) return categoryIds.get("Filtration") ?? null;
    if (sku.startsWith("PLQ")) return categoryIds.get("Freinage") ?? null;
    if (sku.startsWith("AMO")) return categoryIds.get("Suspension") ?? null;
    if (sku.startsWith("EMB")) return categoryIds.get("Transmission") ?? null;
    return categoryIds.get("Moteur") ?? null;
  };

  // --- Produits Auto Parts -------------------------------------------------
  const createdProducts: { id: string; sku: string; salePriceCents: number }[] = [];
  for (const part of AUTO_PARTS_DEMO) {
    const product = await catalogApplication.create(
      company.id,
      {
        sku: part.sku,
        name: part.name,
        description: `Référence OEM ${part.oem} — ${part.manufacturer}`,
        profileType: "AUTO_PARTS",
        categoryId: categoryFor(part.sku),
        unit: "pièce",
        barcode: "",
        purchasePriceCents: part.purchase,
        salePriceCents: part.sale,
        vatRateBp: company.defaultVatRateBp,
        isService: false,
        imageUrls: [],
        minStock: "5",
        variants: [],
        profile: {
          oemReference: part.oem,
          manufacturerId: manufacturerIds.get(part.manufacturer) ?? null,
          countryId: countryByCode.get(part.country) ?? null,
          qualityLevelId: qualityByCode.get(part.quality) ?? null,
          manufacturerRef: "",
          warrantyMonths: 12,
        },
        initialStock: {
          warehouseId: warehouse.id,
          quantity: part.stock,
          unitCostCents: part.purchase,
        },
      },
      userId
    );
    createdProducts.push({
      id: product.id,
      sku: product.sku,
      salePriceCents: product.salePriceCents,
    });
  }

  // Compatibilité : les filtres à huile équipent toutes les Hilux AN120.
  const [hilux] = await db
    .select()
    .from(vehicleModels)
    .where(sql`${vehicleModels.companyId} = ${company.id} and ${vehicleModels.name} = 'Hilux'`)
    .limit(1);
  if (hilux) {
    for (const product of createdProducts.filter((row) => row.sku.startsWith("FH"))) {
      await db
        .insert(partVehicleCompat)
        .values({ companyId: company.id, productId: product.id, modelId: hilux.id })
        .onConflictDoNothing();
    }
  }

  // --- Prestations ---------------------------------------------------------
  const SERVICES = [
    { code: "MO-DIAG", name: "Diagnostic électronique", priceCents: 150000, billingType: "FLAT" },
    { code: "MO-VID", name: "Vidange complète", priceCents: 80000, billingType: "FLAT" },
    { code: "MO-HEURE", name: "Main d'œuvre mécanique", priceCents: 120000, billingType: "HOURLY" },
  ] as const;
  for (const service of SERVICES) {
    await db
      .insert(services)
      .values({
        companyId: company.id,
        code: service.code,
        name: service.name,
        priceCents: service.priceCents,
        billingType: service.billingType,
        vatRateBp: company.defaultVatRateBp,
      })
      .onConflictDoNothing();
  }

  // --- Tiers ---------------------------------------------------------------
  const PARTIES = [
    {
      code: "CLI-0001",
      name: "Garage El Amine",
      partyType: "CUSTOMER",
      phone: "+222 45 25 10 10",
      creditLimitCents: 5_000_000,
      paymentTermsDays: 30,
    },
    {
      code: "CLI-0002",
      name: "Transport Sahel SARL",
      partyType: "CUSTOMER",
      phone: "+222 45 25 20 20",
      creditLimitCents: 12_000_000,
      paymentTermsDays: 45,
    },
    {
      code: "CLI-0003",
      name: "Atelier Nouadhibou",
      partyType: "CUSTOMER",
      phone: "+222 45 74 30 30",
      creditLimitCents: 0,
      paymentTermsDays: 0,
    },
    {
      code: "FRN-0001",
      name: "Gulf Auto Parts FZE",
      partyType: "SUPPLIER",
      phone: "+971 4 123 4567",
      defaultLeadTimeDays: 21,
    },
    {
      code: "FRN-0002",
      name: "Dakar Pièces Import",
      partyType: "SUPPLIER",
      phone: "+221 33 820 00 00",
      defaultLeadTimeDays: 10,
    },
    {
      code: "TRS-0001",
      name: "Sahel Logistique",
      partyType: "BOTH",
      phone: "+222 45 29 40 40",
      paymentTermsDays: 15,
    },
  ] as const;
  const partyIds = new Map<string, string>();
  for (const party of PARTIES) {
    const [row] = await db
      .insert(parties)
      .values({ companyId: company.id, ...party })
      .onConflictDoNothing()
      .returning();
    if (row) partyIds.set(party.code, row.id);
  }

  const customerId = partyIds.get("CLI-0001");
  if (!customerId) return;

  // --- Chaîne commerciale : devis → facture → règlement --------------------
  await salesApplication.createQuote(
    company,
    {
      partyId: customerId,
      notes: "Devis entretien périodique — flotte Hilux.",
      lines: [
        { productId: createdProducts[0].id, quantity: 4 },
        { productId: createdProducts[3].id, quantity: 16 },
        { description: "Main d'œuvre mécanique", quantity: 3, unitPriceCents: 120000 },
      ],
    },
    userId
  );

  const invoice = await invoicingApplication.create(
    company,
    {
      partyId: customerId,
      date: addDays(todayInput(), -3),
      lines: [
        { productId: createdProducts[1].id, quantity: 6 },
        { productId: createdProducts[6].id, quantity: 2 },
      ],
      validate: true,
    },
    userId
  );

  await paymentsApplication.create(
    company,
    {
      partyId: customerId,
      invoiceId: invoice.id,
      amountCents: Math.round(invoice.totalTtcCents / 2),
      paymentMethod: "CASH",
      reference: "Acompte 50 %",
      paymentDate: addDays(todayInput(), -2),
    },
    userId
  );

  // --- Vente comptoir : session de caisse + ticket encaissé ----------------
  const [register] = await db
    .select()
    .from(posRegisters)
    .where(eq(posRegisters.companyId, company.id))
    .limit(1);
  if (register) {
    const session = await posApplication.openSession(company, userId, {
      registerId: register.id,
      openingBalanceCents: 500_000,
      notes: "Session de démonstration",
    });

    const ticketLines = [
      {
        productId: createdProducts[2].id,
        quantity: 2,
        unitPriceCents: createdProducts[2].salePriceCents,
      },
      {
        productId: createdProducts[3].id,
        quantity: 4,
        unitPriceCents: createdProducts[3].salePriceCents,
      },
    ];
    // Le POS exige que le total encaissé soit strictement égal au TTC : on applique
    // ici la **même** fonction de calcul que le serveur, donc aucun écart possible.
    const totals = computeDocumentTotals(
      ticketLines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        vatRateBp: company.defaultVatRateBp,
      })),
      { vatEnabled: company.vatEnabled }
    );

    await posApplication.createTicket(company, userId, {
      sessionId: session.id,
      lines: ticketLines,
      payments: [{ method: "CASH", amountCents: totals.totalTtcCents }],
    });
  }

  // --- Trésorerie ----------------------------------------------------------
  await db
    .insert(bankAccounts)
    .values({
      companyId: company.id,
      code: "BMCI",
      name: "BMCI — Compte courant",
      accountType: "BANK",
      accountNumber: "0001234567",
      currency: company.currency,
    })
    .onConflictDoNothing();

  logger.info("Jeu de démonstration installé", {
    produits: createdProducts.length,
    tiers: partyIds.size,
  });
}

async function main(): Promise<void> {
  const coreOnly = process.argv.includes("--core-only");

  registerPlugins();
  await pluginRegistry.installAll();
  await seedPermissionsAndRoles();

  const company = await seedCompany();
  const userId = await seedAdminUser(company);

  // Tous les modules (fonctionnalités et métiers) sont activés : la démonstration doit
  // montrer la plateforme complète, et une société réelle peut en désactiver à tout moment.
  for (const plugin of pluginRegistry.list()) {
    await pluginRegistry.enableForCompany(company.id, plugin.meta.code);
  }

  if (coreOnly) {
    logger.info("Amorçage limité au noyau (option --core-only).");
    return;
  }

  if (!(await isCompanyEmpty(company.id))) {
    logger.info("La société contient déjà des produits : jeu de démonstration ignoré.");
    return;
  }

  await seedDemoData(company, userId);
}

main()
  .then(async () => {
    logger.info("Amorçage terminé.");
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error("Échec de l'amorçage", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await closeDatabase();
    process.exit(1);
  });
