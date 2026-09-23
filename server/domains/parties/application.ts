/**
 * Cas d'usage des tiers.
 *
 * Deux règles portées ici : l'attribution automatique du code ([FR-TIERS-1]) et le
 * cumul des rôles client/fournisseur sans duplication de fiche ([FR-TIERS-3]).
 */

import { eq } from "drizzle-orm";

import { parties, type Party, type PartyType } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { partiesExtraRepository, partiesRepository } from "./repository";

/** Préfixe de code selon le rôle principal du tiers. */
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
    if (!party) throw new NotFoundError("Tiers introuvable.");
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
    if (!party) throw new NotFoundError("Tiers introuvable.");
    return party;
  }

  async archive(companyId: string, partyId: string) {
    const archived = await partiesRepository.archive(companyId, partyId);
    if (!archived) throw new NotFoundError("Tiers introuvable.");
  }

  /**
   * Garantit qu'un tiers existe pour une vente comptoir : celui fourni, ou le client
   * de passage de la société (créé au premier besoin). Sans cela, une vente POS
   * anonyme n'aurait pas de contrepartie comptable ([BR-7]).
   */
  async ensureWalkInCustomer(companyId: string, tx: Database): Promise<Party> {
    const repository = partiesRepository.withTransaction(tx);
    const existing = await repository.listAll(companyId, {
      where: [eq(parties.code, "CLI-COMPTOIR")],
    });
    if (existing[0]) return existing[0] as Party;
    return repository.create(companyId, {
      code: "CLI-COMPTOIR",
      name: "Client de passage",
      partyType: "CUSTOMER",
      notes: "Créé automatiquement pour les ventes comptoir sans client identifié.",
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
   * Charge un tiers en exigeant son existence.
   *
   * `database` doit être la **transaction en cours** quand l'appelant en a une : un
   * tiers créé quelques lignes plus haut dans la même transaction (client de passage du
   * POS, client créé hors-ligne) n'est pas encore visible depuis une autre connexion.
   */
  async requireParty(companyId: string, partyId: string, database: Database = db): Promise<Party> {
    const party = await partiesRepository.withTransaction(database).findById(companyId, partyId);
    if (!party) throw new NotFoundError("Tiers introuvable.");
    return party as Party;
  }
}

export const partiesApplication = new PartiesApplication();

/** Transaction helper : une transaction pour la création d'un tiers isolé. */
export async function createPartyStandalone(
  companyId: string,
  input: Parameters<PartiesApplication["create"]>[1]
): Promise<Party> {
  return runInTransaction((tx) => partiesApplication.create(companyId, input, tx));
}
