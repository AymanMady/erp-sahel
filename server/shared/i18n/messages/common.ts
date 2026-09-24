/** French and Arabic translations of the cross-cutting messages (errors, middleware). */

import type { MessageCatalog } from "./types";

export const commonMessages: MessageCatalog = {
  fr: {
    "Invalid data": "Données invalides",
    "Authentication required": "Authentification requise",
    "Access denied": "Accès refusé",
    'The "{module}" module is not enabled for this company.':
      "Le module « {module} » n'est pas activé pour cette société.",
    "Resource not found": "Ressource introuvable",
    "Data conflict": "Conflit de données",
    "Service temporarily unavailable": "Service temporairement indisponible",
    "Not possible: this item is referenced by other data.":
      "Impossible : cet élément est référencé par d'autres données.",
    "A required field is missing.": "Un champ obligatoire est manquant.",
    "A product with this SKU already exists.": "Un produit avec cette référence existe déjà.",
    "A party with this code already exists.": "Un tiers avec ce code existe déjà.",
    "A service with this code already exists.": "Une prestation avec ce code existe déjà.",
    "A warehouse with this code already exists.": "Un magasin avec ce code existe déjà.",
    "An account with this number already exists.":
      "Un compte comptable avec ce numéro existe déjà.",
    "A journal with this code already exists.": "Un journal avec ce code existe déjà.",
    "A cash/bank account with this code already exists.":
      "Un compte de trésorerie avec ce code existe déjà.",
    "A register with this code already exists.": "Une caisse avec ce code existe déjà.",
    "This username is already taken.": "Cet identifiant est déjà utilisé.",
    "This subdomain is already taken.": "Ce sous-domaine est déjà pris.",
    "This value already exists.": "Cette valeur existe déjà.",
    "Database temporarily unreachable. Please try again in a moment.":
      "Base de données momentanément injoignable. Réessayez dans un instant.",
    "Internal server error": "Erreur interne du serveur",
    "Unknown endpoint: {method} {path}": "Endpoint inconnu : {method} {path}",
    "Record not found.": "Enregistrement introuvable.",
    "Too many requests. Please try again in a moment.":
      "Trop de requêtes. Réessayez dans un instant.",
    "Idempotency key already used for another request.":
      "Clé d'idempotence déjà utilisée pour une autre requête.",
    // Validation messages of the shared insert schemas (shared/schema).
    "Category name is required": "Le nom de la catégorie est obligatoire",
    "Internal reference (SKU) is required": "La référence interne est obligatoire",
    "Product name is required": "La désignation est obligatoire",
    "Party name is required": "Le nom du tiers est obligatoire",
    "Code is required": "Le code est obligatoire",
    "Label is required": "Le libellé est obligatoire",
  },
  ar: {
    "Invalid data": "بيانات غير صالحة",
    "Authentication required": "المصادقة مطلوبة",
    "Access denied": "تم رفض الوصول",
    'The "{module}" module is not enabled for this company.':
      "الوحدة «{module}» غير مفعّلة لهذه الشركة.",
    "Resource not found": "المورد غير موجود",
    "Data conflict": "تعارض في البيانات",
    "Service temporarily unavailable": "الخدمة غير متاحة مؤقتًا",
    "Not possible: this item is referenced by other data.":
      "غير ممكن: هذا العنصر مرتبط ببيانات أخرى.",
    "A required field is missing.": "حقل إلزامي مفقود.",
    "A product with this SKU already exists.": "يوجد منتج بهذا المرجع بالفعل.",
    "A party with this code already exists.": "يوجد طرف بهذا الرمز بالفعل.",
    "A service with this code already exists.": "توجد خدمة بهذا الرمز بالفعل.",
    "A warehouse with this code already exists.": "يوجد مخزن بهذا الرمز بالفعل.",
    "An account with this number already exists.": "يوجد حساب محاسبي بهذا الرقم بالفعل.",
    "A journal with this code already exists.": "توجد يومية بهذا الرمز بالفعل.",
    "A cash/bank account with this code already exists.": "يوجد حساب خزينة بهذا الرمز بالفعل.",
    "A register with this code already exists.": "يوجد صندوق بهذا الرمز بالفعل.",
    "This username is already taken.": "اسم المستخدم هذا مستخدم بالفعل.",
    "This subdomain is already taken.": "هذا النطاق الفرعي مستخدم بالفعل.",
    "This value already exists.": "هذه القيمة موجودة بالفعل.",
    "Database temporarily unreachable. Please try again in a moment.":
      "تعذّر الوصول إلى قاعدة البيانات مؤقتًا. حاول مرة أخرى بعد قليل.",
    "Internal server error": "خطأ داخلي في الخادم",
    "Unknown endpoint: {method} {path}": "نقطة نهاية غير معروفة: {method} {path}",
    "Record not found.": "السجل غير موجود.",
    "Too many requests. Please try again in a moment.": "طلبات كثيرة جدًا. حاول مرة أخرى بعد قليل.",
    "Idempotency key already used for another request.":
      "مفتاح عدم التكرار مستخدم بالفعل لطلب آخر.",
    "Category name is required": "اسم الفئة مطلوب",
    "Internal reference (SKU) is required": "المرجع الداخلي مطلوب",
    "Product name is required": "اسم المنتج مطلوب",
    "Party name is required": "اسم الطرف مطلوب",
    "Code is required": "الرمز مطلوب",
    "Label is required": "التسمية مطلوبة",
  },
};
