/** Catalog routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { CatalogController } from "./controller";

const canRead = authorize({ anyPermission: ["catalog.read"] });
const canWrite = authorize({ anyPermission: ["catalog.write"] });

export function registerCatalogRoutes(app: Express): void {
  const controller = new CatalogController();

  app.get("/api/catalog/products", requireAuth, canRead, asyncHandler(controller.listProducts));
  app.get(
    "/api/catalog/products/barcode/:barcode",
    requireAuth,
    canRead,
    asyncHandler(controller.getByBarcode)
  );
  app.get("/api/catalog/products/:id", requireAuth, canRead, asyncHandler(controller.getProduct));
  app.post("/api/catalog/products", requireAuth, canWrite, asyncHandler(controller.createProduct));
  app.patch(
    "/api/catalog/products/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateProduct)
  );
  app.delete(
    "/api/catalog/products/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveProduct)
  );

  app.get(
    "/api/catalog/products/:id/suppliers",
    requireAuth,
    canRead,
    asyncHandler(controller.listProductSuppliers)
  );
  app.put(
    "/api/catalog/products/:id/suppliers",
    requireAuth,
    canWrite,
    asyncHandler(controller.upsertProductSupplier)
  );
  app.delete(
    "/api/catalog/products/:id/suppliers/:supplierId",
    requireAuth,
    canWrite,
    asyncHandler(controller.removeProductSupplier)
  );

  app.get("/api/catalog/categories", requireAuth, canRead, asyncHandler(controller.listCategories));
  app.post(
    "/api/catalog/categories",
    requireAuth,
    canWrite,
    asyncHandler(controller.createCategory)
  );
  app.patch(
    "/api/catalog/categories/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateCategory)
  );
  app.delete(
    "/api/catalog/categories/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveCategory)
  );
}
