/** Persistance des tiers, de leurs contacts et de leurs adresses. */

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import {
  contacts,
  parties,
  partyAddresses,
  payments,
  salesInvoices,
  type Party,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const partiesRepository = new TenantRepository(parties, [
  parties.code,
  parties.name,
  parties.email,
  parties.phone,
  parties.vatNumber,
]);

export const contactsRepository = new TenantRepository(contacts, [
  contacts.firstName,
  contacts.lastName,
  contacts.email,
]);

export const partyAddressesRepository = new TenantRepository(partyAddresses, [
  partyAddresses.street,
  partyAddresses.city,
]);

export class PartiesExtraRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): PartiesExtraRepository {
    return new PartiesExtraRepository(tx);
  }

  /**
   * Prochain code disponible pour un type de tiers (`CLI-0001`, `FRN-0001`).
   * Le calcul se fait en base pour rester correct malgré les créations concurrentes ;
   * l'unicité reste garantie par la contrainte `uq_parties_company_code`.
   */
  async nextCode(companyId: string, prefix: string): Promise<string> {
    const [row] = await this.database
      .select({
        maxSuffix: sql<number>`coalesce(max(nullif(regexp_replace(${parties.code}, '^' || ${prefix} || '-', ''), '')::int), 0)`,
      })
      .from(parties)
      .where(
        and(
          eq(parties.companyId, companyId),
          sql`${parties.code} ~ ('^' || ${prefix} || '-[0-9]+$')`
        )
      );
    return `${prefix}-${String((row?.maxSuffix ?? 0) + 1).padStart(4, "0")}`;
  }

  /** Tiers jouant un rôle donné — `BOTH` compte à la fois comme client et fournisseur. */
  async listByRole(
    companyId: string,
    role: "CUSTOMER" | "SUPPLIER",
    options: { search?: string; limit?: number } = {}
  ): Promise<Party[]> {
    return this.database
      .select()
      .from(parties)
      .where(
        and(
          eq(parties.companyId, companyId),
          eq(parties.isActive, true),
          inArray(parties.partyType, [role, "BOTH"]),
          options.search
            ? or(
                sql`${parties.name} ilike ${`%${options.search}%`}`,
                sql`${parties.code} ilike ${`%${options.search}%`}`,
                sql`${parties.phone} ilike ${`%${options.search}%`}`
              )
            : undefined
        )
      )
      .orderBy(asc(parties.name))
      .limit(options.limit ?? 100);
  }

  async listContacts(companyId: string, partyId: string) {
    return this.database
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.companyId, companyId),
          eq(contacts.partyId, partyId),
          eq(contacts.isActive, true)
        )
      )
      .orderBy(asc(contacts.lastName));
  }

  async listAddresses(companyId: string, partyId: string) {
    return this.database
      .select()
      .from(partyAddresses)
      .where(
        and(
          eq(partyAddresses.companyId, companyId),
          eq(partyAddresses.partyId, partyId),
          eq(partyAddresses.isActive, true)
        )
      );
  }

  /** Historique des transactions d'un tiers ([FR-TIERS-5]). */
  async transactionHistory(companyId: string, partyId: string, limit = 50) {
    const [invoices, settlements] = await Promise.all([
      this.database
        .select({
          id: salesInvoices.id,
          number: salesInvoices.number,
          date: salesInvoices.date,
          status: salesInvoices.status,
          totalTtcCents: salesInvoices.totalTtcCents,
          paidAmountCents: salesInvoices.paidAmountCents,
        })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.partyId, partyId)))
        .orderBy(desc(salesInvoices.date))
        .limit(limit),
      this.database
        .select({
          id: payments.id,
          number: payments.number,
          paymentDate: payments.paymentDate,
          amountCents: payments.amountCents,
          paymentMethod: payments.paymentMethod,
          direction: payments.direction,
          invoiceId: payments.invoiceId,
        })
        .from(payments)
        .where(and(eq(payments.companyId, companyId), eq(payments.partyId, partyId)))
        .orderBy(desc(payments.paymentDate))
        .limit(limit),
    ]);
    return { invoices, payments: settlements };
  }

  /** Encours client : total facturé non réglé — pilote le contrôle de limite de crédit. */
  async outstandingBalanceCents(companyId: string, partyId: string): Promise<number> {
    const [row] = await this.database
      .select({
        value: sql<number>`coalesce(sum(${salesInvoices.totalTtcCents} - ${salesInvoices.paidAmountCents}), 0)::int`,
      })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.companyId, companyId),
          eq(salesInvoices.partyId, partyId),
          inArray(salesInvoices.status, ["VALIDATED", "PARTIALLY_PAID"])
        )
      );
    return row?.value ?? 0;
  }

  async counts(companyId: string) {
    const [row] = await this.database
      .select({
        customers: sql<number>`count(*) filter (where ${parties.isActive} and ${parties.partyType} in ('CUSTOMER','BOTH'))::int`,
        suppliers: sql<number>`count(*) filter (where ${parties.isActive} and ${parties.partyType} in ('SUPPLIER','BOTH'))::int`,
      })
      .from(parties)
      .where(eq(parties.companyId, companyId));
    return { customers: row?.customers ?? 0, suppliers: row?.suppliers ?? 0 };
  }
}

export const partiesExtraRepository = new PartiesExtraRepository();
