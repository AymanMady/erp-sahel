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
import { eq, notInArray, sql } from "drizzle-orm";

import { MODULE_PRESETS } from "@shared/modules-catalog";
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
  warehouses,
  type Company,
} from "@shared/schema";
import { closeDatabase, db } from "./db";
import { hashPassword } from "./domains/auth/application";
import { moduleRegistry } from "./domains/plugins/registry";
import { catalogApplication } from "./domains/catalog/application";
import { invoicingApplication } from "./domains/invoicing/application";
import { paymentsApplication } from "./domains/payments/application";
import { posApplication } from "./domains/pos/application";
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
        moduleCode: "core",
      })
      .onConflictDoUpdate({
        target: permissionsTable.code,
        set: { label: PERMISSIONS[code], updatedAt: new Date() },
      });
  }
  // Droits retirés du catalogue (anciens modules métier) : supprimés avec leurs
  // affectations, pour ne plus apparaître dans l'écran des rôles.
  await db
    .delete(permissionsTable)
    .where(notInArray(permissionsTable.code, [...ALL_PERMISSION_CODES]));

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
    name: process.env.SEED_COMPANY_NAME ?? "Sahel Commerce",
    subdomain,
    legalName: process.env.SEED_COMPANY_NAME ?? "Sahel Commerce SARL",
    currency: "MRU",
    language: "fr",
    accountingStandard: "OHADA",
    vatEnabled: true,
    defaultVatRateBp: 1600,
    city: "Nouakchott",
    country: "Mauritanie",
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

/** Catalogue de démonstration : une boutique générale, pour montrer un ERP multi-usage. */
const DEMO_PRODUCTS: {
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchase: number;
  sale: number;
  stock: number;
}[] = [
  {
    sku: "RIZ-25",
    name: "Riz 25 kg",
    category: "Alimentation",
    unit: "sac",
    purchase: 90000,
    sale: 110000,
    stock: 40,
  },
  {
    sku: "HUI-5L",
    name: "Huile 5 L",
    category: "Alimentation",
    unit: "bidon",
    purchase: 38000,
    sale: 45000,
    stock: 60,
  },
  {
    sku: "SUC-1",
    name: "Sucre 1 kg",
    category: "Alimentation",
    unit: "paquet",
    purchase: 4000,
    sale: 5000,
    stock: 150,
  },
  {
    sku: "THE-500",
    name: "Thé vert 500 g",
    category: "Alimentation",
    unit: "paquet",
    purchase: 9000,
    sale: 12000,
    stock: 80,
  },
  {
    sku: "CHG-USB",
    name: "Chargeur téléphone USB",
    category: "Électronique",
    unit: "pièce",
    purchase: 15000,
    sale: 25000,
    stock: 30,
  },
  {
    sku: "FH-HLX",
    name: "Filtre à huile Hilux",
    category: "Pièces auto",
    unit: "pièce",
    purchase: 21000,
    sale: 36000,
    stock: 24,
  },
  {
    sku: "BOU-1",
    name: "Boubou homme",
    category: "Vêtements",
    unit: "pièce",
    purchase: 150000,
    sale: 250000,
    stock: 12,
  },
  {
    sku: "MLH-1",
    name: "Melhfa femme",
    category: "Vêtements",
    unit: "pièce",
    purchase: 120000,
    sale: 200000,
    stock: 15,
  },
];

async function seedDemoData(company: Company, userId: string): Promise<void> {
  const warehouse = (
    await db.select().from(warehouses).where(eq(warehouses.companyId, company.id)).limit(1)
  )[0];
  if (!warehouse) throw new Error("Magasin par défaut absent : amorçage société incomplet.");

  // La démonstration montre tous les modules ; une vraie société démarre en « Simple ».
  await moduleRegistry.applySelection(
    company.id,
    MODULE_PRESETS.find((preset) => preset.code === "full")!.modules
  );

  // --- Catégories et produits --------------------------------------------
  const categoryIds = new Map<string, string>();
  for (const name of new Set(DEMO_PRODUCTS.map((product) => product.category))) {
    const [row] = await db.insert(categories).values({ companyId: company.id, name }).returning();
    if (row) categoryIds.set(name, row.id);
  }

  const createdProducts: { id: string; sku: string; salePriceCents: number }[] = [];
  for (const item of DEMO_PRODUCTS) {
    const product = await catalogApplication.create(
      company.id,
      {
        sku: item.sku,
        name: item.name,
        description: "",
        categoryId: categoryIds.get(item.category) ?? null,
        unit: item.unit,
        barcode: "",
        purchasePriceCents: item.purchase,
        salePriceCents: item.sale,
        vatRateBp: company.defaultVatRateBp,
        isService: false,
        imageUrls: [],
        minStock: "5",
        variants: [],
        initialStock: {
          warehouseId: warehouse.id,
          quantity: item.stock,
          unitCostCents: item.purchase,
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

  // --- Prestations ---------------------------------------------------------
  const SERVICES = [
    { code: "LIV", name: "Livraison", priceCents: 50000, billingType: "FLAT" },
    { code: "INST", name: "Installation", priceCents: 100000, billingType: "FLAT" },
    { code: "MO-HEURE", name: "Main d'œuvre", priceCents: 120000, billingType: "HOURLY" },
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
      name: "Boutique El Amine",
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
      name: "Épicerie Nouadhibou",
      partyType: "CUSTOMER",
      phone: "+222 45 74 30 30",
      creditLimitCents: 0,
      paymentTermsDays: 0,
    },
    {
      code: "FRN-0001",
      name: "Gulf Trading FZE",
      partyType: "SUPPLIER",
      phone: "+971 4 123 4567",
      defaultLeadTimeDays: 21,
    },
    {
      code: "FRN-0002",
      name: "Dakar Import",
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
      notes: "Devis d'approvisionnement mensuel.",
      lines: [
        { productId: createdProducts[0].id, quantity: 4 },
        { productId: createdProducts[3].id, quantity: 16 },
        { description: "Livraison", quantity: 1, unitPriceCents: 50000 },
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

  await seedPermissionsAndRoles();

  const company = await seedCompany();
  const userId = await seedAdminUser(company);

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
