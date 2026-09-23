/** Frontière HTTP des tiers. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { partiesService } from "./service";

export class PartiesController {
  constructor(private readonly service = partiesService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.list(authOf(req).companyId, req.query));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.get(authOf(req).companyId, req.params.id));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.create(authOf(req).companyId, req.body));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.update(authOf(req).companyId, req.params.id, req.body));
  };

  archive = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archive(authOf(req).companyId, req.params.id));
  };

  listContacts = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listContacts(authOf(req).companyId, req.params.id));
  };

  createContact = async (req: Request, res: Response): Promise<void> => {
    res
      .status(201)
      .json(await this.service.createContact(authOf(req).companyId, req.params.id, req.body));
  };

  updateContact = async (req: Request, res: Response): Promise<void> => {
    res.json(
      await this.service.updateContact(authOf(req).companyId, req.params.contactId, req.body)
    );
  };

  archiveContact = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archiveContact(authOf(req).companyId, req.params.contactId));
  };

  listAddresses = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listAddresses(authOf(req).companyId, req.params.id));
  };

  createAddress = async (req: Request, res: Response): Promise<void> => {
    res
      .status(201)
      .json(await this.service.createAddress(authOf(req).companyId, req.params.id, req.body));
  };

  updateAddress = async (req: Request, res: Response): Promise<void> => {
    res.json(
      await this.service.updateAddress(authOf(req).companyId, req.params.addressId, req.body)
    );
  };

  archiveAddress = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.archiveAddress(authOf(req).companyId, req.params.addressId));
  };
}
