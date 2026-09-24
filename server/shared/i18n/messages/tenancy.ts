/** French and Arabic translations of the tenancy messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const tenancyMessages: MessageCatalog = {
  fr: {
    "Company not found.": "Société introuvable.",
    "Company name is required": "Le nom de la société est obligatoire",
    "Subdomain: lowercase letters, digits and hyphens only":
      "Sous-domaine : minuscules, chiffres et tirets uniquement",
    // Default names written when a company is created.
    "Main warehouse": "Magasin principal",
    "Main cash account": "Caisse principale",
    "Register {number}": "Caisse {number}",
  },
  ar: {
    "Company not found.": "الشركة غير موجودة.",
    "Company name is required": "اسم الشركة مطلوب",
    "Subdomain: lowercase letters, digits and hyphens only":
      "النطاق الفرعي: أحرف صغيرة وأرقام وشرطات فقط",
    "Main warehouse": "المخزن الرئيسي",
    "Main cash account": "الصندوق الرئيسي",
    "Register {number}": "الصندوق {number}",
  },
};
