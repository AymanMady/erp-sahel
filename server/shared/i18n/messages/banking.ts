/** French and Arabic translations of the banking messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const bankingMessages: MessageCatalog = {
  fr: {
    "Cash/bank account not found.": "Compte de trésorerie introuvable.",
    "No cash/bank account is configured for this payment method. Create one in Treasury › Accounts.":
      "Aucun compte de trésorerie n'est configuré pour ce mode de règlement. Créez-en un dans Trésorerie › Comptes.",
    "A movement amount must be strictly positive.":
      "Le montant d'un mouvement doit être strictement positif.",
    "The source and destination accounts must differ.":
      "Les comptes source et destination doivent différer.",
    "Internal transfer": "Virement interne",
    "Transaction not found.": "Mouvement introuvable.",
    "Code is required": "Le code est obligatoire",
    "Label is required": "Le libellé est obligatoire",
    "Description is required": "La description est obligatoire",
    "Amount must be greater than zero": "Le montant doit être supérieur à zéro",
    "Invalid identifier": "Identifiant invalide",
  },
  ar: {
    "Cash/bank account not found.": "حساب الخزينة غير موجود.",
    "No cash/bank account is configured for this payment method. Create one in Treasury › Accounts.":
      "لا يوجد حساب خزينة مهيأ لطريقة الدفع هذه. أنشئ حسابًا من الخزينة › الحسابات.",
    "A movement amount must be strictly positive.": "يجب أن يكون مبلغ الحركة موجبًا تمامًا.",
    "The source and destination accounts must differ.": "يجب أن يختلف حساب المصدر عن حساب الوجهة.",
    "Internal transfer": "تحويل داخلي",
    "Transaction not found.": "الحركة غير موجودة.",
    "Code is required": "الرمز إلزامي",
    "Label is required": "التسمية إلزامية",
    "Description is required": "الوصف مطلوب",
    "Amount must be greater than zero": "يجب أن يكون المبلغ أكبر من صفر",
    "Invalid identifier": "معرّف غير صالح",
  },
};
