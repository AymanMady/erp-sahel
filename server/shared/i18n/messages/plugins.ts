/** French and Arabic translations of the plugins messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const pluginsMessages: MessageCatalog = {
  fr: {
    'Unknown module "{code}".': "Module « {code} » inconnu.",
    'First enable "{dependency}", which "{module}" requires.':
      "Activez d'abord « {dependency} », nécessaire pour « {module} ».",
    'First disable "{dependent}", which needs "{module}".':
      "Désactivez d'abord « {dependent} », qui a besoin de « {module} ».",
    // Module names (shared/modules-catalog.ts), used in the messages above and by
    // `ModuleDisabledError`.
    "Point of sale": "Caisse",
    Invoices: "Factures",
    "Quotes and orders": "Devis et commandes",
    Purchasing: "Achats",
    Stock: "Stock",
    Services: "Prestations",
    "Cash and bank": "Caisse et banque",
    Accounting: "Comptabilité",
    Reports: "Rapports",
  },
  ar: {
    'Unknown module "{code}".': "الوحدة «{code}» غير معروفة.",
    'First enable "{dependency}", which "{module}" requires.':
      "فعّل أولًا «{dependency}»، فهي لازمة لـ«{module}».",
    'First disable "{dependent}", which needs "{module}".':
      "عطّل أولًا «{dependent}»، فهي تحتاج إلى «{module}».",
    "Point of sale": "نقطة البيع",
    Invoices: "الفواتير",
    "Quotes and orders": "عروض الأسعار والطلبيات",
    Purchasing: "المشتريات",
    Stock: "المخزون",
    Services: "الخدمات",
    "Cash and bank": "الصندوق والبنك",
    Accounting: "المحاسبة",
    Reports: "التقارير",
  },
};
