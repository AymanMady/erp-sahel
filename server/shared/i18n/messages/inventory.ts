/** French and Arabic translations of the inventory messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const inventoryMessages: MessageCatalog = {
  fr: {
    "No warehouse is configured. Create one in Settings › Warehouses.":
      "Aucun magasin n'est configuré. Créez-en un dans Paramètres › Magasins.",
    "A movement quantity must be strictly positive.":
      "La quantité d'un mouvement doit être strictement positive.",
    "Insufficient stock: {available} available, {requested} requested.":
      "Stock insuffisant : {available} disponible, {requested} demandé.",
    "Source and destination warehouses must differ.":
      "Les magasins source et destination doivent différer.",
    "Inter-warehouse transfer": "Transfert inter-magasins",
    "Warehouse not found.": "Magasin introuvable.",
    "Select a product": "Sélectionnez un produit",
    "Select a warehouse": "Sélectionnez un magasin",
    "Code is required": "Le code est obligatoire",
    "Name is required": "Le nom est obligatoire",
    "Invalid identifier": "Identifiant invalide",
  },
  ar: {
    "No warehouse is configured. Create one in Settings › Warehouses.":
      "لم يتم إعداد أي مخزن. أنشئ مخزنًا من الإعدادات › المخازن.",
    "A movement quantity must be strictly positive.": "يجب أن تكون كمية الحركة موجبة تمامًا.",
    "Insufficient stock: {available} available, {requested} requested.":
      "المخزون غير كافٍ: المتوفر {available}، المطلوب {requested}.",
    "Source and destination warehouses must differ.":
      "يجب أن يختلف المخزن المصدر عن المخزن الوجهة.",
    "Inter-warehouse transfer": "تحويل بين المخازن",
    "Warehouse not found.": "المخزن غير موجود.",
    "Select a product": "اختر منتجًا",
    "Select a warehouse": "اختر مخزنًا",
    "Code is required": "الرمز إلزامي",
    "Name is required": "الاسم إلزامي",
    "Invalid identifier": "معرّف غير صالح",
  },
};
