/**
 * Party use cases.
 *
 * Two rules live here: automatic code assignment ([FR-TIERS-1]) and combining the
 * customer/supplier roles without duplicating the record ([FR-TIERS-3]).
 */

import { eq } from "drizzle-orm";

import { parties, type Party, type PartyType } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { partiesExtraRepository, partiesRepository } from "./repository";

/** Code prefix according to the party's main role. */
function codePrefix(partyType: PartyType): string {
  switch (partyType) {
    case "SUPPLIER":
      return "FRN";
    case "PROSPECT":
      return "PSP";
    case "BOTH":
      return "TRS";
    default:
      return "CLI";
  }
}

class PartiesApplication {
  async list(
    companyId: string,
    options: {
      search?: string;
      partyType?: PartyType | null;
      role?: "CUSTOMER" | "SUPPLIER" | null;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    if (options.role) {
      const items = await partiesExtraRepository.listByRole(companyId, options.role, {
        search: options.search,
        limit: options.limit,
      });
      return { items, total: items.length, limit: options.limit ?? items.length, offset: 0 };
    }
    return partiesRepository.list(companyId, {
      search: options.search,
      includeArchived: options.includeArchived,
      limit: options.limit,
      offset: options.offset,
      where: options.partyType ? [eq(parties.partyType, options.partyType)] : [],
    });
  }

  async create(
    companyId: string,
    input: Omit<Partial<Party>, "id" | "companyId"> & { name: string; partyType?: PartyType },
    database: Database = db
  ): Promise<Party> {
    const partyType = (input.partyType ?? "CUSTOMER") as PartyType;
    const repository = partiesRepository.withTransaction(database);
    const code =
      input.code?.trim() ||
      (await partiesExtraRepository
        .withTransaction(database)
        .nextCode(companyId, codePrefix(partyType)));
    return repository.create(companyId, { ...input, partyType, code }) as Promise<Party>;
  }

  async getDetail(companyId: string, partyId: string) {
    const party = await partiesRepository.findById(companyId, partyId);
    if (!party) throw new NotFoundError("Party not found.");
    const [contacts, addresses, history, outstandingCents] = await Promise.all([
      partiesExtraRepository.listContacts(companyId, partyId),
      partiesExtraRepository.listAddresses(companyId, partyId),
      partiesExtraRepository.transactionHistory(companyId, partyId),
      partiesExtraRepository.outstandingBalanceCents(companyId, partyId),
    ]);
    return { ...party, contacts, addresses, history, outstandingCents };
  }

  async update(companyId: string, partyId: string, patch: Record<string, unknown>) {
    const party = await partiesRepository.update(companyId, partyId, patch);
    if (!party) throw new NotFoundError("Party not found.");
    return party;
  }

  async archive(companyId: string, partyId: string) {
    const archived = await partiesRepository.archive(companyId, partyId);
    if (!archived) throw new NotFoundError("Party not found.");
  }

  /**
   * Guarantees a party exists for a counter sale: the one provided, or the company's
   * walk-in customer (created when first needed). Without it, an anonymous POS sale
   * would have no accounting counterpart ([BR-7]).
   */
  async ensureWalkInCustomer(companyId: string, tx: Database): Promise<Party> {
    const repository = partiesRepository.withTransaction(tx);
    const existing = await repository.listAll(companyId, {
      where: [eq(parties.code, "CLI-COMPTOIR")],
    });
    if (existing[0]) return existing[0] as Party;
    return repository.create(companyId, {
      code: "CLI-COMPTOIR",
      name: tr("Walk-in customer"),
      partyType: "CUSTOMER",
      notes: tr("Created automatically for counter sales without an identified customer."),
    }) as Promise<Party>;
  }

  async counts(companyId: string) {
    return partiesExtraRepository.counts(companyId);
  }

  async outstandingBalanceCents(
    companyId: string,
    partyId: string,
    database: Database = db
  ): Promise<number> {
    return partiesExtraRepository
      .withTransaction(database)
      .outstandingBalanceCents(companyId, partyId);
  }

  /**
   * Loads a party, requiring that it exists.
   *
   * `database` must be the **current transaction** when the caller has one: a party
   * created a few lines earlier in the same transaction (POS walk-in customer, customer
   * created offline) is not yet visible from another connection.
   */
  async requireParty(companyId: string, partyId: string, database: Database = db): Promise<Party> {
    const party = await partiesRepository.withTransaction(database).findById(companyId, partyId);
    if (!party) throw new NotFoundError("Party not found.");
    return party as Party;
  }
}

export const partiesApplication = new PartiesApplication();

/** Transaction helper: one transaction for creating a standalone party. */
export async function createPartyStandalone(
  companyId: string,
  input: Parameters<PartiesApplication["create"]>[1]
): Promise<Party> {
  return runInTransaction((tx) => partiesApplication.create(companyId, input, tx));
}
