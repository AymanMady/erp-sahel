/** French and Arabic translations of the purchasing messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const purchasingMessages: MessageCatalog = {
  fr: {
    "Purchase order not found.": "Commande d'achat introuvable.",
    "A received or cancelled order can no longer be modified.":
      "Une commande reçue ou annulée ne peut plus être modifiée.",
    "Specify the supplier of this receipt.": "Indiquez le fournisseur de cette réception.",
    "Supplier invoice {number}": "Facture fournisseur {number}",
    "Select a supplier": "Sélectionnez un fournisseur",
    "Add at least one line": "Ajoutez au moins une ligne",
    "Specify at least one received item": "Indiquez au moins un article reçu",
    "Invalid identifier": "Identifiant invalide",
  },
  ar: {
    "Purchase order not found.": "أمر الشراء غير موجود.",
    "A received or cancelled order can no longer be modified.":
      "لا يمكن تعديل طلبية مستلمة أو ملغاة.",
    "Specify the supplier of this receipt.": "حدد مورد هذا الاستلام.",
    "Supplier invoice {number}": "فاتورة المورد {number}",
    "Select a supplier": "اختر موردًا",
    "Add at least one line": "أضف سطرًا واحدًا على الأقل",
    "Specify at least one received item": "حدد صنفًا مستلمًا واحدًا على الأقل",
    "Invalid identifier": "معرّف غير صالح",
  },
};
