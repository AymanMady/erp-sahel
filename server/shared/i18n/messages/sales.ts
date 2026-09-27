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
    "Line {line}: service not found.": "Ligne {line} : service introuvable.",
    "Line {line}: the description is required.": "Ligne {line} : la désignation est obligatoire.",
    unit: "unité",
    "Line {line}: the quantity must be a number greater than zero.":
      "Ligne {line} : la quantité doit être un nombre plus grand que zéro.",
    "Line {line}: the price must be zero or more.":
      "Ligne {line} : le prix ne peut pas être négatif.",
    "Line {line}: this model does not belong to the chosen product.":
      "Ligne {line} : ce modèle ne correspond pas au produit choisi.",
    "Line {line}: {item} is no longer sold.": "Ligne {line} : {item} n'est plus vendu.",
    "Line {line}: you are not allowed to change the price of {item}.":
      "Ligne {line} : vous n'avez pas le droit de changer le prix de {item}.",
    "The quantity must be greater than zero": "La quantité doit être plus grande que zéro",
    "The quantity must be a number": "La quantité doit être un nombre",
    "The price must be zero or more": "Le prix ne peut pas être négatif",
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
    "Line {line}: the quantity must be a number greater than zero.":
      "السطر {line}: يجب أن تكون الكمية رقمًا أكبر من صفر.",
    "Line {line}: the price must be zero or more.":
      "السطر {line}: لا يمكن أن يكون السعر أقل من صفر.",
    "Line {line}: this model does not belong to the chosen product.":
      "السطر {line}: هذا النوع لا يخص المنتج المختار.",
    "Line {line}: {item} is no longer sold.": "السطر {line}: {item} لم يعد يُباع.",
    "Line {line}: you are not allowed to change the price of {item}.":
      "السطر {line}: لا يحق لك تغيير سعر {item}.",
    "The quantity must be greater than zero": "يجب أن تكون الكمية أكبر من صفر",
    "The quantity must be a number": "يجب أن تكون الكمية رقمًا",
    "The price must be zero or more": "لا يمكن أن يكون السعر أقل من صفر",
  },
};
