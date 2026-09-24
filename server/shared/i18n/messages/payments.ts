/** French and Arabic translations of the payments messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const paymentsMessages: MessageCatalog = {
  fr: {
    "The payment amount must be strictly positive.":
      "Le montant du règlement doit être strictement positif.",
    "Invoice not found.": "Facture introuvable.",
    "Validate the invoice before recording a payment.":
      "Validez la facture avant d'enregistrer un règlement.",
    "The payment exceeds the amount due ({amount}).":
      "Le règlement dépasse le reste à payer ({amount}).",
    "Payment {number}": "Règlement {number}",
    "Payment not found.": "Règlement introuvable.",
    "Select a party": "Sélectionnez un tiers",
    "Amount must be greater than zero": "Le montant doit être supérieur à zéro",
    "Invalid identifier": "Identifiant invalide",
  },
  ar: {
    "The payment amount must be strictly positive.": "يجب أن يكون مبلغ الدفعة موجبًا تمامًا.",
    "Invoice not found.": "الفاتورة غير موجودة.",
    "Validate the invoice before recording a payment.": "صادِق على الفاتورة قبل تسجيل دفعة.",
    "The payment exceeds the amount due ({amount}).": "تتجاوز الدفعة المبلغ المتبقي ({amount}).",
    "Payment {number}": "دفعة {number}",
    "Payment not found.": "الدفعة غير موجودة.",
    "Select a party": "اختر طرفًا",
    "Amount must be greater than zero": "يجب أن يكون المبلغ أكبر من صفر",
    "Invalid identifier": "معرّف غير صالح",
  },
};
