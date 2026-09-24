/** French and Arabic translations of the point-of-sale messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const posMessages: MessageCatalog = {
  fr: {
    "Register not found.": "Caisse introuvable.",
    'Register "{register}" already has an open session. Close it before opening a new one.':
      "La caisse « {register} » a déjà une session ouverte. Clôturez-la avant d'en ouvrir une nouvelle.",
    "Register session not found.": "Session de caisse introuvable.",
    "The register session is closed: open a new one to take payments.":
      "La session de caisse est clôturée : rouvrez-en une pour encaisser.",
    "The amount collected ({paid}) must equal the ticket total ({total}).":
      "Le total encaissé ({paid}) doit être égal au total du ticket ({total}).",
    "Code is required": "Le code est obligatoire",
    "Name is required": "Le nom est obligatoire",
    "Select a warehouse": "Sélectionnez un magasin",
    "Select a register": "Sélectionnez une caisse",
    "The cart is empty": "Le panier est vide",
    "Specify at least one payment": "Indiquez au moins un règlement",
    "Invalid identifier": "Identifiant invalide",
  },
  ar: {
    "Register not found.": "الصندوق غير موجود.",
    'Register "{register}" already has an open session. Close it before opening a new one.':
      "الصندوق «{register}» لديه جلسة مفتوحة بالفعل. أغلقها قبل فتح جلسة جديدة.",
    "Register session not found.": "جلسة الصندوق غير موجودة.",
    "The register session is closed: open a new one to take payments.":
      "جلسة الصندوق مغلقة: افتح جلسة جديدة لتحصيل المدفوعات.",
    "The amount collected ({paid}) must equal the ticket total ({total}).":
      "يجب أن يساوي المبلغ المحصَّل ({paid}) إجمالي التذكرة ({total}).",
    "Code is required": "الرمز إلزامي",
    "Name is required": "الاسم إلزامي",
    "Select a warehouse": "اختر مخزنًا",
    "Select a register": "اختر صندوقًا",
    "The cart is empty": "السلة فارغة",
    "Specify at least one payment": "حدد دفعة واحدة على الأقل",
    "Invalid identifier": "معرّف غير صالح",
  },
};
