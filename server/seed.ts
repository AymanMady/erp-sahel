/**
 * Database seeding: mandatory master data, then a demo data set.
 *
 * Two deliberately separate stages:
 *  1. Core — **required in production**: permissions, system roles, company,
 *     administrator account, chart of accounts. Idempotent.
 *  2. Demo — demo data set (catalog, parties, sales, POS). Only runs when the company
 *     is empty, so it never pollutes real data.
 *
 * The demo company is French-speaking (Nouakchott): the whole seed runs in the "fr"
 * locale, so default accounts, journals, warehouse and register get French names, and
 * the demo business data is written in French as well.
 *
 * Usage: `npm run db:seed` (core + demo) · `npm run db:seed -- --core-only`.
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
import { withLocale } from "./shared/i18n";
import { logger } from "./shared/logging/logger";

/** Permissions and system roles — shared by every company. */
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
  // Permissions removed from the catalog (former business modules): deleted along
  // with their assignments, so they no longer appear on the roles screen.
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
  logger.info("Permissions and system roles seeded", {
    permissions: ALL_PERMISSION_CODES.length,
    roles: DEFAULT_ROLES.length,
  });
}

/** Working company: the one described by the environment, created if missing. */
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
  logger.info("Company created", { name: company.name, subdomain: company.subdomain });
  return company;
}

/** Initial administrator account, linked to the company with the Administrator role. */
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
    logger.info("Administrator account created", { username, password });
  }
  return user.id;
}

/** True if the company has no product yet: the demo can be installed. */
async function isCompanyEmpty(companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.companyId, companyId));
  return (row?.value ?? 0) === 0;
}

/** Demo catalog: a general store, to show a multi-purpose ERP. */
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
  if (!warehouse) throw new Error("Default warehouse missing: company bootstrap is incomplete.");

  // The demo shows every module; a real company starts at "Simple".
  await moduleRegistry.applySelection(
    company.id,
    MODULE_PRESETS.find((preset) => preset.code === "full")!.modules
  );

  // --- Categories and products --------------------------------------------
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

  // --- Services ------------------------------------------------------------
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

  // --- Parties -------------------------------------------------------------
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

  // --- Sales chain: quote → invoice → payment ------------------------------
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

  // --- Counter sale: POS session + paid ticket -----------------------------
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
    // The POS requires the amount collected to equal the total incl. tax exactly: we
    // apply the **same** calculation function as the server, so no gap is possible.
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

  // --- Cash and bank -------------------------------------------------------
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

  logger.info("Demo data set installed", {
    products: createdProducts.length,
    parties: partyIds.size,
  });
}

async function main(): Promise<void> {
  const coreOnly = process.argv.includes("--core-only");

  await seedPermissionsAndRoles();

  const company = await seedCompany();
  const userId = await seedAdminUser(company);

  if (coreOnly) {
    logger.info("Seeding limited to the core (--core-only option).");
    return;
  }

  if (!(await isCompanyEmpty(company.id))) {
    logger.info("The company already has products: demo data set skipped.");
    return;
  }

  await seedDemoData(company, userId);
}

withLocale("fr", main)
  .then(async () => {
    logger.info("Seeding complete.");
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error("Seeding failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await closeDatabase();
    process.exit(1);
  });
