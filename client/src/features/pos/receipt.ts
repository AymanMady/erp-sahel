/**
 * Printed ticket of a point-of-sale sale.
 *
 * Built from what the till already has in hand — the cart and the payments — so it
 * prints the same with or without network. A sale recorded offline shows its
 * provisional number, and says so.
 */

import type { PaymentMethod } from "@shared/schema";
import { formatDateTime } from "@shared/format";
import { formatMoney, formatQuantity } from "@shared/money";
import type { TicketRow } from "@/features/printing/ticket";
import { i18n } from "@/shared/i18n";
import { cartTotals, type CartLine, type TicketPayment } from "./checkout";

export interface PaidSale {
  number: string;
  /** Recorded without network: the number is provisional until the server's. */
  offline: boolean;
  paidAt: Date;
  lines: CartLine[];
  payments: TicketPayment[];
  customerName: string | null;
}

export interface ReceiptContext {
  companyName: string;
  cashierName: string | null;
}

export function receiptRows(sale: PaidSale, context: ReceiptContext): TicketRow[] {
  const t = i18n.getFixedT(null, "pos");
  const totals = cartTotals(sale.lines);
  const rows: TicketRow[] = [
    { kind: "title", text: context.companyName },
    { kind: "center", text: formatDateTime(sale.paidAt) },
    { kind: "center", text: t("receipt.number", { number: sale.number }), bold: true },
  ];
  if (sale.offline) rows.push({ kind: "center", text: t("receipt.provisional") });
  if (context.cashierName) {
    rows.push({ kind: "text", text: t("receipt.cashier", { name: context.cashierName }) });
  }
  if (sale.customerName) {
    rows.push({ kind: "text", text: t("receipt.customer", { name: sale.customerName }) });
  }
  rows.push({ kind: "rule" });

  sale.lines.forEach((line, index) => {
    const priced = totals.lines[index];
    rows.push({ kind: "text", text: line.name });
    rows.push({
      kind: "pair",
      left: `${formatQuantity(line.quantity)} ${line.unit} × ${formatMoney(line.unitPriceCents)}`,
      right: formatMoney(priced ? priced.totalCents : 0),
    });
  });

  rows.push({ kind: "rule" });
  if (totals.totalDiscountCents > 0) {
    rows.push({
      kind: "pair",
      left: t("receipt.discount"),
      right: `-${formatMoney(totals.totalDiscountCents)}`,
    });
  }
  rows.push({
    kind: "pair",
    left: t("receipt.total"),
    right: formatMoney(totals.totalCents),
    big: true,
  });
  for (const payment of sale.payments) {
    rows.push({
      kind: "pair",
      left: i18n.t(`status:paymentMethods.${payment.method satisfies PaymentMethod}`),
      right: formatMoney(payment.amountCents),
    });
  }
  rows.push({ kind: "rule" }, { kind: "center", text: t("receipt.thanks") }, { kind: "space" });
  return rows;
}
