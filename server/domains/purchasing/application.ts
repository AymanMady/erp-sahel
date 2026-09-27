/**
 * Purchasing orchestration: order → goods receipt → supplier invoice.
 *
 * The **goods receipt** is the only moment stock comes in ([FR-ACH-3]); the **supplier
 * invoice** is the only moment the payable is posted. The two
 * remain separate: goods may arrive before their invoice and vice versa — the ERP must
 * reflect that without forcing an artificial order.
 */

import {
  CURRENCY,
  formatMoney,
  formatQuantity,
  normalizeQuantity,
  roundHalfUp,
} from "@shared/money";
import { addDays, todayInput } from "@shared/format";
import { buildSupplierInvoicePosting } from "@shared/accounting-rules";
import { computeDocumentTotals, derivePaymentStatus, remainingToPayCents } from "@shared/pricing";
import type { Company, PurchaseOrder, PurchaseOrderLine, SupplierInvoice } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
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
        priceList: "purchase",
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
        totalCents: built.totalCents,
        currency: CURRENCY,
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

      // Once goods have arrived, the lines, the discount and the supplier are what the
      // stock was valued with: changing them would rewrite what was received.
      const alreadyReceived = order.lines.some(
        (line) => normalizeQuantity(line.receivedQuantity) > 0
      );
      const discountChanged =
        input.globalDiscountBp !== undefined && input.globalDiscountBp !== order.globalDiscountBp;
      if (
        alreadyReceived &&
        (input.lines !== undefined ||
          discountChanged ||
          (input.supplierId !== undefined && input.supplierId !== order.supplierId))
      ) {
        throw new BusinessRuleError(
          "Some goods of this order have already arrived. You can no longer change its items, its discount or its supplier.",
          "PURCHASE_ORDER_PARTIALLY_RECEIVED"
        );
      }

      const patch: Partial<PurchaseOrder> = {
        supplierId: input.supplierId ?? order.supplierId,
        warehouseId: input.warehouseId ?? order.warehouseId,
        date: input.date ?? order.date,
        expectedDate: input.expectedDate ?? order.expectedDate,
        notes: input.notes ?? order.notes,
        globalDiscountBp: input.globalDiscountBp ?? order.globalDiscountBp,
      };

      if (input.lines) {
        const built = await buildDocumentLines(tx, company, input.lines, {
          globalDiscountBp: patch.globalDiscountBp,
          priceList: "purchase",
        });
        await repository.replaceOrderLines(
          company.id,
          orderId,
          built.lines.map((line) => ({ ...line, receivedQuantity: "0" }))
        );
        patch.totalCents = built.totalCents;
      } else if (discountChanged) {
        // Only the discount changed: the existing lines are re-totalled with it.
        const totals = computeDocumentTotals(
          order.lines.map((line) => ({
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            discountBp: line.discountBp,
          })),
          { globalDiscountBp: patch.globalDiscountBp }
        );
        for (const [index, line] of order.lines.entries()) {
          await repository.updateOrderLineTotal(
            company.id,
            line.id,
            totals.lines[index].totalCents
          );
        }
        patch.totalCents = totals.totalCents;
      }

      await repository.updateOrder(company.id, orderId, patch);
      return (await repository.findOrder(company.id, orderId))!;
    });
  }

  /**
   * Manual status change. Only a draft or a sent order can be sent, put back to draft or
   * cancelled; "received" is never set by hand — it comes from the goods receipts.
   */
  async setOrderStatus(
    companyId: string,
    orderId: string,
    status: PurchaseOrder["status"]
  ): Promise<PurchaseOrder> {
    if (!MANUAL_ORDER_STATUSES.includes(status)) {
      throw new BusinessRuleError(
        "An order becomes received only when you record the goods that arrived.",
        "PURCHASE_ORDER_STATUS_FORBIDDEN"
      );
    }
    const order = await purchasingRepository.updateOrderStatusIf(
      companyId,
      orderId,
      status,
      MANUAL_ORDER_STATUSES.filter((from) => from !== "CANCELLED")
    );
    if (order) return order;
    const existing = await purchasingRepository.findOrder(companyId, orderId);
    if (!existing) throw new NotFoundError("Purchase order not found.");
    throw new BusinessRuleError(
      "Goods of this order have already arrived, or it was cancelled. Its state can no longer be changed.",
      "PURCHASE_ORDER_FROZEN"
    );
  }

  /**
   * Validates a goods receipt: stock comes in at purchase cost, then the order progress
   * is updated (partially received / received).
   */
  async createReceipt(company: Company, input: ReceiptInput, userId?: string | null) {
    return runInTransaction(async (tx) => {
      const repository = purchasingRepository.withTransaction(tx);
      const date = input.date ?? todayInput();

      if (input.purchaseOrderId) await repository.lockOrder(company.id, input.purchaseOrderId);
      const order = input.purchaseOrderId
        ? await repository.findOrder(company.id, input.purchaseOrderId)
        : null;
      if (input.purchaseOrderId && !order) {
        throw new NotFoundError("Purchase order not found.");
      }
      if (order?.status === "CANCELLED") {
        throw new BusinessRuleError(
          "This order was cancelled. Its goods can no longer be received.",
          "PURCHASE_ORDER_CANCELLED"
        );
      }
      if (order?.status === "RECEIVED") {
        throw new BusinessRuleError(
          "All the goods of this order have already been received.",
          "PURCHASE_ORDER_ALREADY_RECEIVED"
        );
      }

      // The supplier of an order is the order's, whatever the request says.
      const supplierId = order?.supplierId ?? input.supplierId;
      if (!supplierId) {
        throw new BusinessRuleError("Specify the supplier of this receipt.");
      }
      await partiesApplication.requireParty(company.id, supplierId, tx);

      const warehouseId =
        input.warehouseId ??
        order?.warehouseId ??
        (await inventoryApplication.defaultWarehouseId(company.id, tx));

      // Checks the products and models belong to the company, and reads their purchase
      // price — the cost used when neither the request nor the order gives one.
      const catalog = await buildDocumentLines(
        tx,
        company,
        input.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
        })),
        { priceList: "purchase" }
      );

      const lines = input.lines.map((line, index) => {
        const quantity = normalizeQuantity(line.quantity);
        const orderLine = order ? matchOrderLine(order.lines, line, index + 1) : null;
        return {
          ...line,
          quantity,
          orderLine,
          unitCostCents: receiptUnitCost(
            line.unitCostCents,
            orderLine,
            catalog.lines[index].unitPriceCents
          ),
        };
      });

      // Never more than what is left to receive on each order line.
      const requestedByOrderLine = new Map<string, number>();
      for (const line of lines) {
        if (!line.orderLine) continue;
        const id = line.orderLine.id;
        requestedByOrderLine.set(
          id,
          normalizeQuantity((requestedByOrderLine.get(id) ?? 0) + line.quantity)
        );
      }
      for (const [id, requested] of requestedByOrderLine) {
        const orderLine = order!.lines.find((candidate) => candidate.id === id)!;
        const remaining = normalizeQuantity(
          normalizeQuantity(orderLine.quantity) - normalizeQuantity(orderLine.receivedQuantity)
        );
        if (requested > remaining) throw overReceipt(orderLine, remaining, requested);
      }

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
        lines.map((line) => ({
          companyId: company.id,
          receiptId: receipt.id,
          purchaseOrderLineId: line.orderLine?.id ?? null,
          productId: line.productId,
          variantId: line.variantId ?? null,
          lotNumber: line.lotNumber ?? "",
          quantity: line.quantity.toFixed(3),
          unitCostCents: line.unitCostCents,
        }))
      );

      await inventoryApplication.receiveForDocument(tx, {
        companyId: company.id,
        warehouseId,
        originId: receipt.id,
        reference: receipt.number,
        userId,
        lines: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          unitCostCents: line.unitCostCents,
          lotNumber: line.lotNumber,
        })),
      });

      if (order) {
        for (const [id, requested] of requestedByOrderLine) {
          const added = await repository.addReceivedQuantity(company.id, id, requested.toFixed(3));
          if (!added) {
            const orderLine = order.lines.find((candidate) => candidate.id === id)!;
            throw overReceipt(orderLine, 0, requested);
          }
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

  /** Supplier invoice: purchases and payable ([FR-ACH-4], [BR-7]). */
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
      if (
        input.purchaseOrderId &&
        !(await repository.findOrder(company.id, input.purchaseOrderId))
      ) {
        throw new NotFoundError("Purchase order not found.");
      }
      if (input.receiptId && !(await repository.findReceipt(company.id, input.receiptId))) {
        throw new NotFoundError("Goods receipt not found.");
      }
      const built = await buildDocumentLines(tx, company, input.lines, { priceList: "purchase" });
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
        totalCents: built.totalCents,
        currency: CURRENCY,
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
          totalCents: line.totalCents,
          position: line.position,
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
          totalCents: invoice.totalCents,
          partyId: supplier.id,
          label,
        }),
      });

      return invoice;
    });
  }

  /**
   * Applies a payment to a supplier invoice. Called by the `payments` domain, within
   * **its** transaction, so that payment and status stay consistent. A negative amount
   * cancels a payment.
   */
  async applySupplierPayment(
    tx: Database,
    companyId: string,
    supplierInvoiceId: string,
    amountCents: number
  ): Promise<SupplierInvoice> {
    const repository = purchasingRepository.withTransaction(tx);
    const invoice = await repository.addSupplierPaidAmount(
      companyId,
      supplierInvoiceId,
      amountCents
    );
    if (!invoice) throw new NotFoundError("Supplier invoice not found.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      throw new BusinessRuleError(
        "This supplier invoice is not validated or was cancelled: it cannot be paid.",
        "SUPPLIER_INVOICE_NOT_PAYABLE"
      );
    }
    if (invoice.paidAmountCents > invoice.totalCents) {
      const due = remainingToPayCents(invoice.totalCents, invoice.paidAmountCents - amountCents);
      throw new BusinessRuleError(
        tr("This payment is more than what is still owed to the supplier ({amount}).", {
          amount: formatMoney(due),
        }),
        "OVERPAYMENT"
      );
    }
    if (invoice.paidAmountCents < 0) {
      throw new BusinessRuleError(
        "You cannot take back more than what was paid on this invoice.",
        "NEGATIVE_PAYMENT"
      );
    }
    const status = derivePaymentStatus(invoice.totalCents, invoice.paidAmountCents);
    const updated = await repository.updateSupplierInvoice(companyId, supplierInvoiceId, {
      status,
    });
    return updated ?? invoice;
  }

  /** Amount still owed on a supplier invoice, in cents (never negative). */
  async supplierInvoiceAmountDue(
    companyId: string,
    supplierInvoiceId: string,
    database: Database = db
  ): Promise<number> {
    const invoice = await purchasingRepository
      .withTransaction(database)
      .findSupplierInvoice(companyId, supplierInvoiceId);
    if (!invoice) throw new NotFoundError("Supplier invoice not found.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") return 0;
    return remainingToPayCents(invoice.totalCents, invoice.paidAmountCents);
  }

  async getOrder(companyId: string, orderId: string): Promise<PurchaseOrderWithLines> {
    const order = await purchasingRepository.findOrder(companyId, orderId);
    if (!order) throw new NotFoundError("Purchase order not found.");
    return order;
  }
}

/** Statuses a person may set by hand; the received ones come from the goods receipts. */
const MANUAL_ORDER_STATUSES: PurchaseOrder["status"][] = ["DRAFT", "ORDERED", "CANCELLED"];

/**
 * Order line a receipt line belongs to: the one it names, or else the first line of the
 * same product that still has goods to receive.
 */
function matchOrderLine(
  orderLines: PurchaseOrderLine[],
  line: ReceiptInput["lines"][number],
  position: number
): PurchaseOrderLine {
  const remaining = (candidate: PurchaseOrderLine) =>
    normalizeQuantity(candidate.quantity) > normalizeQuantity(candidate.receivedQuantity);
  const found = line.purchaseOrderLineId
    ? orderLines.find((candidate) => candidate.id === line.purchaseOrderLineId)
    : (orderLines.find((c) => c.productId === line.productId && remaining(c)) ??
      orderLines.find((c) => c.productId === line.productId));
  if (!found || found.productId !== line.productId) {
    throw new BusinessRuleError(
      tr("Line {line}: this item is not on the order.", { line: position }),
      "RECEIPT_LINE_NOT_ON_ORDER"
    );
  }
  return found;
}

/**
 * Unit cost of a received item, used for the stock value:
 * - the cost typed at reception, when it is a real price;
 * - otherwise the order price **after its discounts** (line and whole-order discount);
 * - otherwise the purchase price of the product.
 * Older screens send the order price before discount: it is replaced by the net price.
 */
function receiptUnitCost(
  typedCostCents: number | undefined,
  orderLine: PurchaseOrderLine | null,
  catalogCostCents: number
): number {
  const orderQuantity = orderLine ? normalizeQuantity(orderLine.quantity) : 0;
  const orderNetCents =
    orderLine && orderQuantity > 0 ? roundHalfUp(orderLine.totalCents / orderQuantity) : null;
  const typed = typedCostCents ?? 0;
  if (typed > 0 && !(orderLine && typed === orderLine.unitPriceCents)) return typed;
  return orderNetCents ?? (typed > 0 ? typed : catalogCostCents);
}

function overReceipt(
  orderLine: PurchaseOrderLine,
  remaining: number,
  requested: number
): BusinessRuleError {
  return new BusinessRuleError(
    tr("{item}: only {remaining} left to receive on this order, but {requested} was entered.", {
      item: orderLine.description,
      remaining: formatQuantity(remaining),
      requested: formatQuantity(requested),
    }),
    "RECEIPT_EXCEEDS_ORDER",
    { purchaseOrderLineId: orderLine.id, remaining, requested }
  );
}

export const purchasingApplication = new PurchasingApplication();
