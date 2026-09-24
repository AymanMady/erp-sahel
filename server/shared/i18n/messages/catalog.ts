/** French and Arabic translations of the catalog messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const catalogMessages: MessageCatalog = {
  fr: {
    "Product not found.": "Produit introuvable.",
    "Category not found.": "Catégorie introuvable.",
    "No product matches this barcode.": "Aucun produit ne correspond à ce code-barres.",
    "Variant SKU is required": "Référence de variante obligatoire",
    "Internal SKU is required": "La référence interne est obligatoire",
    "Product name is required": "La désignation est obligatoire",
    "Name is required": "Le nom est obligatoire",
    "Invalid identifier": "Identifiant invalide",
    unit: "unité",
    "Initial stock on product creation": "Stock initial à la création du produit",
  },
  ar: {
    "Product not found.": "المنتج غير موجود.",
    "Category not found.": "الفئة غير موجودة.",
    "No product matches this barcode.": "لا يوجد منتج يطابق هذا الرمز الشريطي.",
    "Variant SKU is required": "مرجع المتغير إلزامي",
    "Internal SKU is required": "المرجع الداخلي إلزامي",
    "Product name is required": "اسم المنتج إلزامي",
    "Name is required": "الاسم إلزامي",
    "Invalid identifier": "معرّف غير صالح",
    unit: "وحدة",
    "Initial stock on product creation": "المخزون الأولي عند إنشاء المنتج",
  },
};
