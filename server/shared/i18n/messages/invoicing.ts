/** French and Arabic translations of the invoicing messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const invoicingMessages: MessageCatalog = {
  fr: {
    // Errors
    "Credit limit exceeded for {party}: limit {limit}, outstanding after invoicing {outstanding}.":
      "Encours dépassé pour {party} : limite {limit}, encours après facturation {outstanding}.",
    "Invoice not found.": "Facture introuvable.",
    "Only a draft can be validated (current status: {status}).":
      "Seul un brouillon peut être validé (statut actuel : {status}).",
    "An invoice without lines cannot be validated.":
      "Une facture sans ligne ne peut pas être validée.",
    "A validated invoice cannot be modified: issue a credit note to correct it.":
      "Une facture validée est inaltérable : émettez un avoir pour la corriger.",
    "A validated invoice cannot be cancelled: issue a credit note.":
      "Une facture validée ne peut pas être annulée : émettez un avoir.",
    "A credit note can only apply to a validated invoice.":
      "Un avoir ne peut porter que sur une facture validée.",
    "The credit note amount exceeds that of the original invoice.":
      "Le montant de l'avoir dépasse celui de la facture d'origine.",
    "The total paid would exceed the invoice amount.":
      "Le total réglé dépasserait le montant de la facture.",
    // Validation
    "Select a customer": "Sélectionnez un client",
    "Add at least one line": "Ajoutez au moins une ligne",
    "Invalid identifier": "Identifiant invalide",
    // Accounting entry labels
    "Invoice {number}": "Facture {number}",
    "Credit note {number}": "Avoir {number}",
    "Credit note {number} (invoice {invoice})": "Avoir {number} (facture {invoice})",
  },
  ar: {
    // Errors
    "Credit limit exceeded for {party}: limit {limit}, outstanding after invoicing {outstanding}.":
      "تم تجاوز سقف الائتمان لـ {party}: السقف {limit}، والرصيد المستحق بعد الفوترة {outstanding}.",
    "Invoice not found.": "الفاتورة غير موجودة.",
    "Only a draft can be validated (current status: {status}).":
      "لا يمكن المصادقة إلا على مسودة (الحالة الحالية: {status}).",
    "An invoice without lines cannot be validated.": "لا يمكن المصادقة على فاتورة بدون أسطر.",
    "A validated invoice cannot be modified: issue a credit note to correct it.":
      "لا يمكن تعديل فاتورة مصادق عليها: أصدِر إشعارًا دائنًا لتصحيحها.",
    "A validated invoice cannot be cancelled: issue a credit note.":
      "لا يمكن إلغاء فاتورة مصادق عليها: أصدِر إشعارًا دائنًا.",
    "A credit note can only apply to a validated invoice.":
      "لا يمكن أن يخص الإشعار الدائن إلا فاتورة مصادقًا عليها.",
    "The credit note amount exceeds that of the original invoice.":
      "مبلغ الإشعار الدائن يتجاوز مبلغ الفاتورة الأصلية.",
    "The total paid would exceed the invoice amount.": "سيتجاوز إجمالي المدفوع مبلغ الفاتورة.",
    // Validation
    "Select a customer": "اختر عميلًا",
    "Add at least one line": "أضف سطرًا واحدًا على الأقل",
    "Invalid identifier": "معرّف غير صالح",
    // Accounting entry labels
    "Invoice {number}": "فاتورة {number}",
    "Credit note {number}": "إشعار دائن {number}",
    "Credit note {number} (invoice {invoice})": "إشعار دائن {number} (فاتورة {invoice})",
  },
};
