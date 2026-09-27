/**
 * French and Arabic translations of the Excel import and export (column titles, values,
 * problems found in a file), keyed by the English source text.
 *
 * Column titles are also how an imported file is read back: changing one here still
 * accepts files written with the old title only if the old title stays in some language.
 */

import type { MessageCatalog } from "./types";

export const spreadsheetMessages: MessageCatalog = {
  fr: {
    Yes: "Oui",
    No: "Non",
    "No file received. Choose an Excel file (.xlsx).":
      "Aucun fichier reçu. Choisissez un fichier Excel (.xlsx).",
    "This file cannot be read. Save it in Excel format (.xlsx) and try again.":
      "Ce fichier ne peut pas être lu. Enregistrez-le au format Excel (.xlsx) et réessayez.",
    "The file is empty.": "Le fichier est vide.",
    "Column missing from the file: {columns}. Start from an exported file.":
      "Colonne absente du fichier : {columns}. Partez d'un fichier exporté.",
    "The file has no rows to import.": "Le fichier ne contient aucune ligne à importer.",
    "The file has {count} rows; the maximum is {max}. Split it into several files.":
      "Le fichier contient {count} lignes ; le maximum est {max}. Découpez-le en plusieurs fichiers.",
    "The amount cannot be negative.": "Le montant ne peut pas être négatif.",
    "The quantity cannot be negative.": "La quantité ne peut pas être négative.",
    "Enter a whole number between 0 and {max}.": "Mettez un nombre entier entre 0 et {max}.",
    "Write « {yes} » or « {no} ».": "Écrivez « {yes} » ou « {no} ».",
    "Unknown value « {value} ». Allowed: {choices}.":
      "Valeur inconnue « {value} ». Possible : {choices}.",
    "This is not a number.": "Ce n'est pas un nombre.",
    "« {value} » is not a number.": "« {value} » n'est pas un nombre.",
    "This text is too long ({max} characters at most).":
      "Ce texte est trop long ({max} caractères au maximum).",
    "The file has {count} problem(s). Nothing was saved: fix the file and import it again.":
      "Le fichier contient {count} problème(s). Rien n'a été enregistré : corrigez le fichier puis importez-le de nouveau.",
    "The code {code} is already used on row {row}.":
      "Le code {code} est déjà utilisé à la ligne {row}.",

    // Products sheet
    Products: "Produits",
    products: "produits",
    "Product code": "Code du produit",
    "Product name": "Nom du produit",
    Category: "Catégorie",
    "Sold by": "Vendu par",
    Barcode: "Code-barres",
    "Purchase price (MRU)": "Prix d'achat (MRU)",
    "Sale price (MRU)": "Prix de vente (MRU)",
    "Service (no stock)": "Service (sans stock)",
    "Warn when stock falls below": "Prévenir quand il en reste moins de",
    Description: "Description",
    "The product name is missing.": "Le nom du produit est vide.",

    // Customers and suppliers sheet
    "Customers and suppliers": "Clients et fournisseurs",
    "customers-suppliers": "clients-fournisseurs",
    Code: "Code",
    Name: "Nom",
    Type: "Type",
    Phone: "Téléphone",
    "Maximum credit allowed (MRU)": "Crédit maximum autorisé (MRU)",
    "Days to pay": "Nombre de jours pour payer",
    "Delivery time (days)": "Délai de livraison (jours)",
    Notes: "Remarques",
    Customer: "Client",
    Supplier: "Fournisseur",
    "Customer and supplier": "Client et fournisseur",
    "Possible customer": "Client possible",
    "The name is missing.": "Le nom est vide.",
  },
  ar: {
    Yes: "نعم",
    No: "لا",
    "No file received. Choose an Excel file (.xlsx).": "لم يصل أي ملف. اختر ملف Excel (.xlsx).",
    "This file cannot be read. Save it in Excel format (.xlsx) and try again.":
      "تعذرت قراءة هذا الملف. احفظه بصيغة Excel (.xlsx) وأعد المحاولة.",
    "The file is empty.": "الملف فارغ.",
    "Column missing from the file: {columns}. Start from an exported file.":
      "عمود غير موجود في الملف: {columns}. ابدأ من ملف مُصدَّر.",
    "The file has no rows to import.": "لا يحتوي الملف على أي سطر للاستيراد.",
    "The file has {count} rows; the maximum is {max}. Split it into several files.":
      "يحتوي الملف على {count} سطرًا؛ الحد الأقصى هو {max}. قسّمه إلى عدة ملفات.",
    "The amount cannot be negative.": "لا يمكن أن يكون المبلغ سالبًا.",
    "The quantity cannot be negative.": "لا يمكن أن تكون الكمية سالبة.",
    "Enter a whole number between 0 and {max}.": "أدخل عددًا صحيحًا بين 0 و{max}.",
    "Write « {yes} » or « {no} ».": "اكتب « {yes} » أو « {no} ».",
    "Unknown value « {value} ». Allowed: {choices}.":
      "قيمة غير معروفة « {value} ». القيم الممكنة: {choices}.",
    "This is not a number.": "هذا ليس رقمًا.",
    "« {value} » is not a number.": "« {value} » ليس رقمًا.",
    "This text is too long ({max} characters at most).":
      "هذا النص طويل جدًا ({max} حرفًا على الأكثر).",
    "The file has {count} problem(s). Nothing was saved: fix the file and import it again.":
      "يحتوي الملف على {count} مشكلة. لم يُحفظ أي شيء: صحّح الملف ثم استورده من جديد.",
    "The code {code} is already used on row {row}.": "الرمز {code} مستعمل من قبل في السطر {row}.",

    // Products sheet
    Products: "المنتجات",
    products: "المنتجات",
    "Product code": "رمز المنتج",
    "Product name": "اسم المنتج",
    Category: "الفئة",
    "Sold by": "يباع بـ",
    Barcode: "الرمز الشريطي",
    "Purchase price (MRU)": "سعر الشراء (MRU)",
    "Sale price (MRU)": "سعر البيع (MRU)",
    "Service (no stock)": "خدمة (بدون مخزون)",
    "Warn when stock falls below": "التنبيه عندما يقل المخزون عن",
    Description: "الوصف",
    "The product name is missing.": "اسم المنتج فارغ.",

    // Customers and suppliers sheet
    "Customers and suppliers": "العملاء والموردون",
    "customers-suppliers": "العملاء-والموردون",
    Code: "الرمز",
    Name: "الاسم",
    Type: "النوع",
    Phone: "الهاتف",
    "Maximum credit allowed (MRU)": "الحد الأقصى للدين (MRU)",
    "Days to pay": "عدد أيام الدفع",
    "Delivery time (days)": "مدة التسليم (أيام)",
    Notes: "ملاحظات",
    Customer: "عميل",
    Supplier: "مورد",
    "Customer and supplier": "زبون ومورد",
    "Possible customer": "زبون محتمل",
    "The name is missing.": "الاسم فارغ.",
  },
};
