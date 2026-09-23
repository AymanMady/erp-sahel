/** Persistance du domaine société (tenant). */

import { asc, eq, sql } from "drizzle-orm";

import { companies, companySettings, type Company, type InsertCompany } from "@shared/schema";
import { db, type Database } from "../../db";

export class CompaniesRepository {
  constructor(private readonly database: Database = db) {}

  async findById(companyId: string): Promise<Company | null> {
    const [row] = await this.database
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return row ?? null;
  }

  async findBySubdomain(subdomain: string): Promise<Company | null> {
    const [row] = await this.database
      .select()
      .from(companies)
      .where(sql`lower(${companies.subdomain}) = lower(${subdomain})`)
      .limit(1);
    return row ?? null;
  }

  async listAll(limit = 100): Promise<Company[]> {
    return this.database
      .select()
      .from(companies)
      .where(eq(companies.isActive, true))
      .orderBy(asc(companies.name))
      .limit(limit);
  }

  async create(input: InsertCompany, tx: Database = this.database): Promise<Company> {
    const [row] = await tx.insert(companies).values(input).returning();
    return row;
  }

  async update(companyId: string, patch: Partial<InsertCompany>): Promise<Company | null> {
    const [row] = await this.database
      .update(companies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(companies.id, companyId))
      .returning();
    return row ?? null;
  }

  async listSettings(companyId: string) {
    return this.database
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId));
  }

  async upsertSetting(companyId: string, key: string, value: string): Promise<void> {
    const [existing] = await this.database
      .select({ id: companySettings.id })
      .from(companySettings)
      .where(sql`${companySettings.companyId} = ${companyId} and ${companySettings.key} = ${key}`)
      .limit(1);
    if (existing) {
      await this.database
        .update(companySettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(companySettings.id, existing.id));
      return;
    }
    await this.database.insert(companySettings).values({ companyId, key, value });
  }
}

export const companiesRepository = new CompaniesRepository();
