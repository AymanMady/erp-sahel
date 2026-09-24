/** French and Arabic translations of the sync messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const syncMessages: MessageCatalog = {
  fr: {
    'Entity "{entity}" is not supported by this server.':
      "Entité « {entity} » non prise en charge par ce serveur.",
    "Waiting for {dependency} to be synchronized.":
      "En attente de la synchronisation de {dependency}.",
    "Unknown error during ingestion.": "Erreur inconnue à l'ingestion.",
    "Dependency not synchronized yet ({clientUuid}): operation postponed to the next cycle.":
      "Dépendance non encore synchronisée ({clientUuid}) : opération reportée au prochain cycle.",
    "The quote does not reference any customer.": "Le devis ne référence aucun client.",
    "The payment references neither a party nor an invoice: it cannot be allocated.":
      "Le règlement ne référence ni tiers ni facture : impossible de l'imputer.",
    "The closing does not reference any session.": "La clôture ne référence aucune session.",
  },
  ar: {
    'Entity "{entity}" is not supported by this server.':
      "الكيان «{entity}» غير مدعوم من طرف هذا الخادم.",
    "Waiting for {dependency} to be synchronized.": "في انتظار مزامنة {dependency}.",
    "Unknown error during ingestion.": "خطأ غير معروف أثناء الاستيعاب.",
    "Dependency not synchronized yet ({clientUuid}): operation postponed to the next cycle.":
      "تبعية لم تتم مزامنتها بعد ({clientUuid}): تم تأجيل العملية إلى الدورة التالية.",
    "The quote does not reference any customer.": "عرض السعر لا يشير إلى أي عميل.",
    "The payment references neither a party nor an invoice: it cannot be allocated.":
      "الدفعة لا تشير إلى أي طرف أو فاتورة: يتعذّر تخصيصها.",
    "The closing does not reference any session.": "الإقفال لا يشير إلى أي جلسة.",
  },
};
