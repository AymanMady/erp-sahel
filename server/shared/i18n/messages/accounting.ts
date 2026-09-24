/** French and Arabic translations of the accounting messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const accountingMessages: MessageCatalog = {
  fr: {
    // Errors
    'Accounting not configured: no account is mapped to "{key}" (expected: {code} — {name}).':
      "Comptabilité non configurée : aucun compte n'est associé à « {key} » (attendu : {code} — {name}).",
    'Accounting not configured: no account is mapped to "{key}".':
      "Comptabilité non configurée : aucun compte n'est associé à « {key} ».",
    "An entry must have at least one non-zero line.":
      "Une écriture doit comporter au moins une ligne mouvementée.",
    'No journal of type "{type}" is configured for this company.':
      "Aucun journal de type « {type} » n'est configuré pour cette société.",
    "Fiscal year {name} is closed: no entry can be added to it.":
      "L'exercice {name} est clôturé : aucune écriture ne peut y être ajoutée.",
    "Account not found.": "Compte introuvable.",
    "This account has entries: it cannot be archived.":
      "Ce compte porte des écritures : il ne peut pas être archivé.",
    "Journal not found.": "Journal introuvable.",
    "A line cannot be both a debit and a credit.":
      "Une ligne ne peut pas être simultanément au débit et au crédit.",
    "The end date must be after the start date.":
      "La date de fin doit être postérieure à la date de début.",
    "Fiscal year not found.": "Exercice introuvable.",
    // Validation
    "Account number is required": "Le numéro de compte est obligatoire",
    "Label is required": "Le libellé est obligatoire",
    "An entry has at least two lines": "Une écriture comporte au moins deux lignes",
    "Invalid identifier": "Identifiant invalide",
    // Automatic entry labels
    "VAT — {label}": "TVA — {label}",
    // Default chart of accounts
    Capital: "Capital",
    "Share capital": "Capital social",
    Reserves: "Réserves",
    "Retained earnings": "Report à nouveau",
    "Retained earnings / Net income": "Report à nouveau / Résultat",
    "Net income for the year": "Résultat de l'exercice",
    Goods: "Marchandises",
    "Goods inventory": "Stock de marchandises",
    Suppliers: "Fournisseurs",
    "Suppliers, trade payables": "Fournisseurs, dettes en compte",
    Customers: "Clients",
    "State and public authorities": "État et collectivités",
    "VAT charged on sales": "TVA facturée sur ventes",
    "Recoverable VAT on purchases": "TVA récupérable sur achats",
    Banks: "Banques",
    "Local banks": "Banques locales",
    "Financial institutions": "Établissements financiers",
    "Mobile money": "Mobile money",
    "Cash on hand": "Caisse",
    "Head office cash": "Caisse siège social",
    "Purchases and inventory changes": "Achats et variations de stocks",
    "Purchases of goods": "Achats de marchandises",
    "Change in goods inventory": "Variation des stocks de marchandises",
    "Other expenses": "Autres charges",
    "Miscellaneous expenses": "Charges diverses",
    Sales: "Ventes",
    "Sales of goods": "Ventes de marchandises",
    "Services sold": "Services vendus",
    "Rebates, discounts and allowances granted": "Rabais, remises et ristournes accordés",
    "Opening entries": "À-nouveaux",
    "Opening balance sheet": "Bilan d'ouverture",
    "Goods inventories": "Stocks de marchandises",
    "VAT collected": "TVA collectée",
    "Deductible VAT": "TVA déductible",
    "Change in inventories": "Variation des stocks",
    "Miscellaneous operating expenses": "Charges diverses de gestion",
    // Default journals
    "Sales journal": "Journal des ventes",
    "Purchases journal": "Journal des achats",
    "Bank journal": "Journal de banque",
    "Cash journal": "Journal de caisse",
    "Miscellaneous operations": "Opérations diverses",
  },
  ar: {
    // Errors
    'Accounting not configured: no account is mapped to "{key}" (expected: {code} — {name}).':
      "المحاسبة غير مهيأة: لا يوجد حساب مرتبط بـ «{key}» (المتوقع: {code} — {name}).",
    'Accounting not configured: no account is mapped to "{key}".':
      "المحاسبة غير مهيأة: لا يوجد حساب مرتبط بـ «{key}».",
    "An entry must have at least one non-zero line.":
      "يجب أن يتضمن القيد سطرًا واحدًا على الأقل بمبلغ غير صفري.",
    'No journal of type "{type}" is configured for this company.':
      "لا توجد يومية من نوع «{type}» مهيأة لهذه الشركة.",
    "Fiscal year {name} is closed: no entry can be added to it.":
      "السنة المالية {name} مقفلة: لا يمكن إضافة أي قيد إليها.",
    "Account not found.": "الحساب غير موجود.",
    "This account has entries: it cannot be archived.":
      "يحتوي هذا الحساب على قيود: لا يمكن أرشفته.",
    "Journal not found.": "اليومية غير موجودة.",
    "A line cannot be both a debit and a credit.":
      "لا يمكن أن يكون السطر مدينًا ودائنًا في آن واحد.",
    "The end date must be after the start date.": "يجب أن يكون تاريخ النهاية بعد تاريخ البداية.",
    "Fiscal year not found.": "السنة المالية غير موجودة.",
    // Validation
    "Account number is required": "رقم الحساب مطلوب",
    "Label is required": "التسمية إلزامية",
    "An entry has at least two lines": "يتضمن القيد سطرين على الأقل",
    "Invalid identifier": "معرّف غير صالح",
    // Automatic entry labels
    "VAT — {label}": "ض.ق.م — {label}",
    // Default chart of accounts
    Capital: "رأس المال",
    "Share capital": "رأس المال الاجتماعي",
    Reserves: "الاحتياطيات",
    "Retained earnings": "النتائج المرحّلة",
    "Retained earnings / Net income": "النتائج المرحّلة / النتيجة",
    "Net income for the year": "نتيجة السنة المالية",
    Goods: "البضائع",
    "Goods inventory": "مخزون البضائع",
    Suppliers: "الموردون",
    "Suppliers, trade payables": "الموردون، ديون تجارية",
    Customers: "العملاء",
    "State and public authorities": "الدولة والجماعات العمومية",
    "VAT charged on sales": "الضريبة على القيمة المضافة المفوترة على المبيعات",
    "Recoverable VAT on purchases": "الضريبة على القيمة المضافة القابلة للاسترداد على المشتريات",
    Banks: "البنوك",
    "Local banks": "البنوك المحلية",
    "Financial institutions": "المؤسسات المالية",
    "Mobile money": "الأموال عبر الهاتف المحمول",
    "Cash on hand": "الصندوق",
    "Head office cash": "صندوق المقر الرئيسي",
    "Purchases and inventory changes": "المشتريات وتغيرات المخزون",
    "Purchases of goods": "مشتريات البضائع",
    "Change in goods inventory": "تغير مخزون البضائع",
    "Other expenses": "أعباء أخرى",
    "Miscellaneous expenses": "أعباء متنوعة",
    Sales: "المبيعات",
    "Sales of goods": "مبيعات البضائع",
    "Services sold": "الخدمات المباعة",
    "Rebates, discounts and allowances granted": "التخفيضات والخصومات والحسومات الممنوحة",
    "Opening entries": "قيود الافتتاح",
    "Opening balance sheet": "الميزانية الافتتاحية",
    "Goods inventories": "مخزونات البضائع",
    "VAT collected": "الضريبة على القيمة المضافة المحصّلة",
    "Deductible VAT": "الضريبة على القيمة المضافة القابلة للخصم",
    "Change in inventories": "تغير المخزونات",
    "Miscellaneous operating expenses": "أعباء تسيير متنوعة",
    // Default journals
    "Sales journal": "يومية المبيعات",
    "Purchases journal": "يومية المشتريات",
    "Bank journal": "يومية البنك",
    "Cash journal": "يومية الصندوق",
    "Miscellaneous operations": "عمليات متنوعة",
  },
};
