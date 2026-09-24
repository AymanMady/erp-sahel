/**
 * Purchasing orchestration: order → goods receipt → supplier invoice.
 *
 * The **goods receipt** is the only moment stock comes in ([FR-ACH-3]); the **supplier
 * invoice** is the only moment the payable and the recoverable VAT are posted. The two
 * remain separate: goods may arrive before their invoice and vice versa — the ERP must
 * reflect that without forcing an artificial order.
 */

import { normalizeQuantity } from "@shared/money";
import { addDays, todayInput } from "@shared/format";
import { buildSupplierInvoicePosting } from "@shared/accounting-rules";
import type { Company, PurchaseOrder } from "@shared/schema";
import { runInTransaction } from "../../db";
import { buildDocumentLines, type RawDocumentLine } from "../../shared/documents/line-builder";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { accountingApplication } from "../accounting/application";
import { inventoryApplication } from "../inventory/application";
import { numberingApplication } from "../numbering/application";
import { partiesApplication } from "../parties/application";
import { purchasingRepository, type PurchaseOrderWithLines } from "./repository";

export interface PurchaseOrderInput {
  supplierId: string;
  warehouseId?: string | null;
  date?: string;
  expectedDate?: string | null;
  globalDiscountBp?: number;
  notes?: string;
  lines: RawDocumentLine[];
}

export interface ReceiptInput {
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  warehouseId?: string | null;
  date?: string;
  notes?: string;
  lines: {
    purchaseOrderLineId?: string | null;
    productId: string;
    variantId?: string | null;
    lotNumber?: string;
    quantity: number | string;
    unitCostCents?: number;
  }[];
}

class PurchasingApplication {
  async createOrder(
    company: Company,
    input: PurchaseOrderInput,
    userId?: string | null
  ): Promise<PurchaseOrderWithLines> {
    return runInTransaction(async (tx) => {
      const repository = purchasingRepository.withTransaction(tx);
      const date = input.date ?? todayInput();
      const supplier = await partiesApplication.requireParty(company.id, input.supplierId, tx);

      const built = await buildDocumentLines(tx, company, input.lines, {
        globalDiscountBp: input.globalDiscountBp,
      });
      const number = await numberingApplication.allocateForCompany(
        tx,
        company,
        "PURCHASE_ORDER",
        date
      );

      const order = await repository.insertOrder({
        companyId: company.id,
        number,
        supplierId: supplier.id,
        warehouseId:
          input.warehouseId ?? (await inventoryApplication.defaultWarehouseId(company.id, tx)),
        date,
        expectedDate:
          input.expectedDate ??
          (supplier.defaultLeadTimeDays > 0 ? addDays(date, supplier.defaultLeadTimeDays) : null),
        status: "DRAFT",
        globalDiscountBp: input.globalDiscountBp ?? 0,
        totalHtCents: built.totalHtCents,
        totalVatCents: built.totalVatCents,
        totalTtcCents: built.totalTtcCents,
        currency: company.currency,
        notes: input.notes ?? "",
        userId: userId ?? null,
      });

      await repository.replaceOrderLines(
        company.id,
        order.id,
        built.lines.map((line) => ({ ...line, receivedQuantity: "0" }))
      );
      return (await repository.findOrder(company.id, order.id))!;
    });
  }

  async updateOrder(
    company: Company,
    orderId: string,
    input: Partial<PurchaseOrderInput>
  ): Promise<PurchaseOrderWithLines> {
    return runInTransaction(async (tx) => {
      const repository = purchasingRepository.withTransaction(tx);
      const order = await repository.findOrder(company.id, orderId);
      if (!order) throw new NotFoundError("Purchase order not found.");
      if (order.status === "RECEIVED" || order.status === "CANCELLED") {
        throw new BusinessRuleError(
          "A received or cancelled order can no longer be modified.",
          "PURCHASE_ORDER_FROZEN"
        );
      }

      const patch: Record<string, unknown> = {
        supplierId: input.supplierId ?? order.supplierId,
        warehouseId: input.warehouseId ?? order.warehouseId,
        date: input.date ?? order.date,
        expectedDate: input.expectedDate ?? order.expectedDate,
        notes: input.notes ?? order.notes,
        globalDiscountBp: input.globalDiscountBp ?? order.globalDiscountBp,
      };

      if (input.lines) {
        const built = await buildDocumentLines(tx, company, input.lines, {
          globalDiscountBp: patch.globalDiscountBp as number,
        });
        await repository.replaceOrderLines(
          company.id,
          orderId,
          built.lines.map((line) => ({ ...line, receivedQuantity: "0" }))
        );
        patch.totalHtCents = built.totalHtCents;
        patch.totalVatCents = built.totalVatCents;
        patch.totalTtcCents = built.totalTtcCents;
      }

      await repository.updateOrder(company.id, orderId, patch);
      return (await repository.findOrder(company.id, orderId))!;
    });
  }

  async setOrderStatus(
    companyId: string,
    orderId: string,
    status: PurchaseOrder["status"]
  ): Promise<PurchaseOrder> {
    const order = await purchasingRepository.updateOrder(companyId, orderId, { status });
    if (!order) throw new NotFoundError("Purchase order not found.");
    return order;
  }

  /**
   * Validates a goods receipt: stock comes in at purchase cost, then the order progress
   * is updated (partially received / received).
   */
  async createReceipt(company: Company, input: ReceiptInput, userId?: string | null) {
    return runInTransaction(async (tx) => {
      const repository = purchasingRepository.withTransaction(tx);
      const date = input.date ?? todayInput();

      const order = input.purchaseOrderId
        ? await repository.findOrder(company.id, input.purchaseOrderId)
        : null;
      if (input.purchaseOrderId && !order) {
        throw new NotFoundError("Purchase order not found.");
      }

      const supplierId = input.supplierId ?? order?.supplierId;
      if (!supplierId) {
        throw new BusinessRuleError("Specify the supplier of this receipt.");
      }
      await partiesApplication.requireParty(company.id, supplierId, tx);

      const warehouseId =
        input.warehouseId ??
        order?.warehouseId ??
        (await inventoryApplication.defaultWarehouseId(company.id, tx));

      const number = await numberingApplication.allocateForCompany(
        tx,
        company,
        "GOODS_RECEIPT",
        date
      );
      const receipt = await repository.insertReceipt({
        companyId: company.id,
        number,
        purchaseOrderId: order?.id ?? null,
        supplierId,
        warehouseId,
        date,
        status: "VALIDATED",
        notes: input.notes ?? "",
        userId: userId ?? null,
      });

      await repository.insertReceiptLines(
        input.lines.map((line) => ({
          companyId: company.id,
          receiptId: receipt.id,
          purchaseOrderLineId: line.purchaseOrderLineId ?? null,
          productId: line.productId,
          variantId: line.variantId ?? null,
          lotNumber: line.lotNumber ?? "",
          quantity: normalizeQuantity(line.quantity).toFixed(3),
          unitCostCents: line.unitCostCents ?? 0,
        }))
      );

      await inventoryApplication.receiveForDocument(tx, {
        companyId: company.id,
        warehouseId,
        originId: receipt.id,
        reference: receipt.number,
        userId,
        lines: input.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCostCents: line.unitCostCents ?? 0,
          lotNumber: line.lotNumber,
        })),
      });

      if (order) {
        for (const line of input.lines) {
          if (!line.purchaseOrderLineId) continue;
          await repository.addReceivedQuantity(
            company.id,
            line.purchaseOrderLineId,
            normalizeQuantity(line.quantity).toFixed(3)
          );
        }
        const refreshed = await repository.findOrder(company.id, order.id);
        const fullyReceived = (refreshed?.lines ?? []).every(
          (line) => normalizeQuantity(line.receivedQuantity) >= normalizeQuantity(line.quantity)
        );
        await repository.updateOrder(company.id, order.id, {
          status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
        });
      }

      return (await repository.findReceipt(company.id, receipt.id))!;
    });
  }

  /** Supplier invoice: payable and recoverable VAT ([FR-ACH-4], [BR-7]). */
  async createSupplierInvoice(
    company: Company,
    input: {
      supplierId: string;
      supplierReference?: string;
      purchaseOrderId?: string | null;
      receiptId?: string | null;
      date?: string;
      dueDate?: string | null;
      notes?: string;
      lines: RawDocumentLine[];
    }
  ) {
    return runInTransaction(async (tx) => {
      const repository = purchasingRepository.withTransaction(tx);
      const date = input.date ?? todayInput();
      const supplier = await partiesApplication.requireParty(company.id, input.supplierId, tx);
      const built = await buildDocumentLines(tx, company, input.lines);
      const number = await numberingApplication.allocateForCompany(
        tx,
        company,
        "SUPPLIER_INVOICE",
        date
      );

      const invoice = await repository.insertSupplierInvoice({
        companyId: company.id,
        number,
        supplierReference: input.supplierReference ?? "",
        supplierId: supplier.id,
        purchaseOrderId: input.purchaseOrderId ?? null,
        receiptId: input.receiptId ?? null,
        date,
        dueDate:
          input.dueDate ??
          (supplier.paymentTermsDays > 0 ? addDays(date, supplier.paymentTermsDays) : date),
        status: "VALIDATED",
        totalHtCents: built.totalHtCents,
        totalVatCents: built.totalVatCents,
        totalTtcCents: built.totalTtcCents,
        currency: company.currency,
        notes: input.notes ?? "",
      });

      await repository.insertSupplierInvoiceLines(
        built.lines.map((line) => ({
          companyId: company.id,
          invoiceId: invoice.id,
          productId: line.productId,
          variantId: line.variantId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          discountBp: line.discountBp,
          vatRateBp: line.vatRateBp,
          totalHtCents: line.totalHtCents,
          totalVatCents: line.totalVatCents,
          totalTtcCents: line.totalTtcCents,
          position: line.position,
          originCountry: line.originCountry,
        }))
      );

      const label = tr("Supplier invoice {number}", { number: invoice.number });
      await accountingApplication.postEntry(tx, {
        company,
        journalType: "PURCHASES",
        date,
        label,
        reference: invoice.supplierReference || invoice.number,
        originType: "supplier_invoice",
        originId: invoice.id,
        lines: buildSupplierInvoicePosting({
          totalHtCents: invoice.totalHtCents,
          totalVatCents: invoice.totalVatCents,
          totalTtcCents: invoice.totalTtcCents,
          partyId: supplier.id,
          label,
          vatLabel: tr("VAT — {label}", { label }),
        }),
      });

      return invoice;
    });
  }

  async getOrder(companyId: string, orderId: string): Promise<PurchaseOrderWithLines> {
    const order = await purchasingRepository.findOrder(companyId, orderId);
    if (!order) throw new NotFoundError("Purchase order not found.");
    return order;
  }
}

export const purchasingApplication = new PurchasingApplication();
