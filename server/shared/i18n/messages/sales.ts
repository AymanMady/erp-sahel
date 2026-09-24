/** French and Arabic translations of the sales messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const salesMessages: MessageCatalog = {
  fr: {
    "Quote not found.": "Devis introuvable.",
    "An accepted or converted quote can no longer be modified.":
      "Un devis accepté ou converti ne peut plus être modifié.",
    "This quote has already been converted.": "Ce devis a déjà été converti.",
    "A rejected or expired quote cannot be converted.":
      "Un devis refusé ou expiré ne peut pas être converti.",
    "Order not found.": "Commande introuvable.",
    "This order has already been invoiced.": "Cette commande est déjà facturée.",
    "A cancelled order cannot be invoiced.": "Une commande annulée ne peut pas être facturée.",
    "Select a customer": "Sélectionnez un client",
    "Add at least one line": "Ajoutez au moins une ligne",
    "Invalid identifier": "Identifiant invalide",
    // Document line builder (server/shared/documents/line-builder.ts)
    "The document must have at least one line.": "Le document doit comporter au moins une ligne.",
    "Line {line}: product not found or belongs to another company.":
      "Ligne {line} : produit introuvable ou appartenant à une autre société.",
    "Line {line}: service not found.": "Ligne {line} : prestation introuvable.",
    "Line {line}: the description is required.": "Ligne {line} : la désignation est obligatoire.",
    unit: "unité",
  },
  ar: {
    "Quote not found.": "عرض السعر غير موجود.",
    "An accepted or converted quote can no longer be modified.":
      "لا يمكن تعديل عرض سعر مقبول أو محوَّل.",
    "This quote has already been converted.": "تم تحويل عرض السعر هذا مسبقًا.",
    "A rejected or expired quote cannot be converted.":
      "لا يمكن تحويل عرض سعر مرفوض أو منتهي الصلاحية.",
    "Order not found.": "الطلبية غير موجودة.",
    "This order has already been invoiced.": "تمت فوترة هذه الطلبية مسبقًا.",
    "A cancelled order cannot be invoiced.": "لا يمكن فوترة طلبية ملغاة.",
    "Select a customer": "اختر عميلًا",
    "Add at least one line": "أضف سطرًا واحدًا على الأقل",
    "Invalid identifier": "معرّف غير صالح",
    // Document line builder (server/shared/documents/line-builder.ts)
    "The document must have at least one line.": "يجب أن يحتوي المستند على سطر واحد على الأقل.",
    "Line {line}: product not found or belongs to another company.":
      "السطر {line}: المنتج غير موجود أو يتبع شركة أخرى.",
    "Line {line}: service not found.": "السطر {line}: الخدمة غير موجودة.",
    "Line {line}: the description is required.": "السطر {line}: الوصف إلزامي.",
    unit: "وحدة",
  },
};
