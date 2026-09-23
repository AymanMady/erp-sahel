/** Frontière HTTP du catalogue. */

import type { Request, Response } from "express";

import { authOf } from "../auth/guards";
import { catalogService } from "./service";

export class CatalogController {
  constructor(private readonly service = catalogService) {}

  listProducts = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.searchProducts(auth.companyId, req.query));
  };

  getProduct = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.getProduct(auth.companyId, req.params.id));
  };

  getByBarcode = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.findByBarcode(auth.companyId, String(req.params.barcode)));
  };

  createProduct = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createProduct(auth.companyId, req.body, auth.userId));
  };

  updateProduct = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.updateProduct(auth.companyId, req.params.id, req.body));
  };

  archiveProduct = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.archiveProduct(auth.companyId, req.params.id));
  };

  listCategories = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.listCategories(auth.companyId));
  };

  createCategory = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.status(201).json(await this.service.createCategory(auth.companyId, req.body));
  };

  updateCategory = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.updateCategory(auth.companyId, req.params.id, req.body));
  };

  archiveCategory = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.archiveCategory(auth.companyId, req.params.id));
  };

  listProductSuppliers = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.listProductSuppliers(auth.companyId, req.params.id));
  };

  upsertProductSupplier = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(await this.service.upsertProductSupplier(auth.companyId, req.params.id, req.body));
  };

  removeProductSupplier = async (req: Request, res: Response): Promise<void> => {
    const auth = authOf(req);
    res.json(
      await this.service.removeProductSupplier(auth.companyId, req.params.id, req.params.supplierId)
    );
  };
}
