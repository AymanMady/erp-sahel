/** Purchasing validation contracts. */

import { z } from "zod";

import { PURCHASE_ORDER_STATUSES, SUPPLIER_INVOICE_STATUSES } from "@shared/schema";
import { documentLineSchema } from "../invoicing/schemas";

export const listOrdersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).nullish(),
  supplierId: z.string().uuid().nullish(),
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createOrderSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  warehouseId: z.string().uuid().nullish(),
  date: z.string().date().optional(),
  expectedDate: z.string().date().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(4000).default(""),
  lines: z.array(documentLineSchema).min(1, "Add at least one line"),
});

export const updateOrderSchema = createOrderSchema.partial();

export const orderStatusSchema = z.object({ status: z.enum(PURCHASE_ORDER_STATUSES) });

export const createReceiptSchema = z.object({
  purchaseOrderId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  date: z.string().date().optional(),
  notes: z.string().max(2000).default(""),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().uuid().nullish(),
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        lotNumber: z.string().max(64).default(""),
        quantity: z.union([z.number().positive(), z.string()]),
        unitCostCents: z.number().int().min(0).default(0),
      })
    )
    .min(1, "Specify at least one received item"),
});

export const listSupplierInvoicesQuerySchema = z.object({
  supplierId: z.string().uuid().nullish(),
  status: z.enum(SUPPLIER_INVOICE_STATUSES).nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createSupplierInvoiceSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  supplierReference: z.string().max(100).default(""),
  purchaseOrderId: z.string().uuid().nullish(),
  receiptId: z.string().uuid().nullish(),
  date: z.string().date().optional(),
  dueDate: z.string().date().nullish(),
  notes: z.string().max(4000).default(""),
  lines: z.array(documentLineSchema).min(1, "Add at least one line"),
});

export const idParamSchema = z.object({ id: z.string().uuid("Invalid identifier") });
