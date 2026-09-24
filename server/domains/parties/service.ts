/** Application boundary of parties. */

import { runInTransaction } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { partiesApplication } from "./application";
import { contactsRepository, partiesExtraRepository, partyAddressesRepository } from "./repository";
import {
  addressSchema,
  contactSchema,
  createPartySchema,
  idParamSchema,
  listPartiesQuerySchema,
  updatePartySchema,
} from "./schemas";

export class PartiesService {
  async list(companyId: string, query: unknown) {
    const parsed = listPartiesQuerySchema.parse(query ?? {});
    return partiesApplication.list(companyId, parsed);
  }

  async get(companyId: string, id: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    return partiesApplication.getDetail(companyId, partyId);
  }

  async create(companyId: string, body: unknown) {
    const data = createPartySchema.parse(body);
    return runInTransaction((tx) => partiesApplication.create(companyId, data, tx));
  }

  async update(companyId: string, id: unknown, body: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    return partiesApplication.update(companyId, partyId, updatePartySchema.parse(body));
  }

  async archive(companyId: string, id: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    await partiesApplication.archive(companyId, partyId);
    return { success: true as const };
  }

  async listContacts(companyId: string, id: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    return partiesExtraRepository.listContacts(companyId, partyId);
  }

  async createContact(companyId: string, id: unknown, body: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    await partiesApplication.requireParty(companyId, partyId);
    return contactsRepository.create(companyId, { ...contactSchema.parse(body), partyId });
  }

  async updateContact(companyId: string, contactId: unknown, body: unknown) {
    const { id } = idParamSchema.parse({ id: contactId });
    const contact = await contactsRepository.update(
      companyId,
      id,
      contactSchema.partial().parse(body)
    );
    if (!contact) throw new NotFoundError("Contact not found.");
    return contact;
  }

  async archiveContact(companyId: string, contactId: unknown) {
    const { id } = idParamSchema.parse({ id: contactId });
    const archived = await contactsRepository.archive(companyId, id);
    if (!archived) throw new NotFoundError("Contact not found.");
    return { success: true as const };
  }

  async listAddresses(companyId: string, id: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    return partiesExtraRepository.listAddresses(companyId, partyId);
  }

  async createAddress(companyId: string, id: unknown, body: unknown) {
    const { id: partyId } = idParamSchema.parse({ id });
    await partiesApplication.requireParty(companyId, partyId);
    const data = addressSchema.parse(body);
    return partyAddressesRepository.create(companyId, {
      ...data,
      country: data.country ?? tr("Mauritania"),
      partyId,
    });
  }

  async updateAddress(companyId: string, addressId: unknown, body: unknown) {
    const { id } = idParamSchema.parse({ id: addressId });
    const address = await partyAddressesRepository.update(
      companyId,
      id,
      addressSchema.partial().parse(body)
    );
    if (!address) throw new NotFoundError("Address not found.");
    return address;
  }

  async archiveAddress(companyId: string, addressId: unknown) {
    const { id } = idParamSchema.parse({ id: addressId });
    const archived = await partyAddressesRepository.archive(companyId, id);
    if (!archived) throw new NotFoundError("Address not found.");
    return { success: true as const };
  }
}

export const partiesService = new PartiesService();
