/** French and Arabic translations of the invoicing messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const invoicingMessages: MessageCatalog = {
  fr: {
    // Errors
    "Credit limit exceeded for {party}: limit {limit}, outstanding after invoicing {outstanding}.":
      "{party} dépasse son crédit maximum : maximum {limit}, il devrait {outstanding} avec cette facture.",
    "Invoice not found.": "Facture introuvable.",
    "Only a draft can be validated (current status: {status}).":
      "Seule une facture en préparation peut être validée (état actuel : {status}).",
    "An invoice without lines cannot be validated.":
      "Une facture sans ligne ne peut pas être validée.",
    "A validated invoice cannot be modified: issue a credit note to correct it.":
      "Une facture validée ne peut plus être modifiée : faites un retour pour la corriger.",
    "A validated invoice cannot be cancelled: issue a credit note.":
      "Une facture validée ne peut pas être annulée : faites un retour de marchandise.",
    "A credit note can only apply to a validated invoice.":
      "Un retour ne peut se faire que sur une facture validée.",
    "The credit note amount exceeds that of the original invoice.":
      "Le montant du retour dépasse celui de la facture.",
    "The total paid would exceed the invoice amount.":
      "Le total réglé dépasserait le montant de la facture.",
    // Validation
    "Select a customer": "Sélectionnez un client",
    "Add at least one line": "Ajoutez au moins une ligne",
    "Invalid identifier": "Identifiant invalide",
    // Accounting entry labels
    "Invoice {number}": "Facture {number}",
    "Credit note {number}": "Retour {number}",
    "Credit note {number} (invoice {invoice})": "Retour {number} (facture {invoice})",
    "The date cannot be before that of the last validated invoice ({date}): numbers must follow the dates.":
      "La date ne peut pas être avant celle de la dernière facture validée ({date}) : les numéros doivent suivre les dates.",
    "Line {line}: this item is not on the invoice.":
      "Ligne {line} : ce produit n'est pas sur la facture.",
    "Everything on this invoice has already been returned.":
      "Tout ce qui est sur cette facture a déjà été rendu.",
    "{item}: only {quantity} can still be returned.":
      "{item} : on peut encore rendre {quantity} au maximum.",
    "Only a validated invoice that is not cancelled can be paid.":
      "Seule une facture validée et non annulée peut être payée.",
    "This invoice belongs to another customer.": "Cette facture appartient à un autre client.",
    "The payment is more than what is still owed on this invoice ({due}).":
      "Le paiement est plus grand que ce qui reste à payer sur cette facture ({due}).",
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
      "لا يمكن تعديل فاتورة مؤكدة: قم بإرجاع لتصحيحها.",
    "A validated invoice cannot be cancelled: issue a credit note.":
      "لا يمكن إلغاء فاتورة مؤكدة: قم بإرجاع المنتجات.",
    "A credit note can only apply to a validated invoice.": "لا يمكن الإرجاع إلا على فاتورة مؤكدة.",
    "The credit note amount exceeds that of the original invoice.":
      "مبلغ الإرجاع أكبر من مبلغ الفاتورة.",
    "The total paid would exceed the invoice amount.": "سيتجاوز إجمالي المدفوع مبلغ الفاتورة.",
    // Validation
    "Select a customer": "اختر عميلًا",
    "Add at least one line": "أضف سطرًا واحدًا على الأقل",
    "Invalid identifier": "معرّف غير صالح",
    // Accounting entry labels
    "Invoice {number}": "فاتورة {number}",
    "Credit note {number}": "إرجاع {number}",
    "Credit note {number} (invoice {invoice})": "إرجاع {number} (فاتورة {invoice})",
    "The date cannot be before that of the last validated invoice ({date}): numbers must follow the dates.":
      "لا يمكن أن يكون التاريخ قبل تاريخ آخر فاتورة مؤكدة ({date}): يجب أن تتبع الأرقام التواريخ.",
    "Line {line}: this item is not on the invoice.": "السطر {line}: هذا المنتج ليس في الفاتورة.",
    "Everything on this invoice has already been returned.":
      "كل ما في هذه الفاتورة تم إرجاعه من قبل.",
    "{item}: only {quantity} can still be returned.": "{item}: يمكن إرجاع {quantity} فقط.",
    "Only a validated invoice that is not cancelled can be paid.":
      "لا يمكن دفع إلا فاتورة مؤكدة وغير ملغاة.",
    "This invoice belongs to another customer.": "هذه الفاتورة تخص زبونًا آخر.",
    "The payment is more than what is still owed on this invoice ({due}).":
      "المبلغ المدفوع أكبر مما بقي للدفع في هذه الفاتورة ({due}).",
  },
};
