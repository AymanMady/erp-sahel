/** French and Arabic translations of the sync messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const syncMessages: MessageCatalog = {
  fr: {
    'Entity "{entity}" is not supported by this server.':
      "L'opération « {entity} » n'est pas reconnue par l'application.",
    "Waiting for {dependency} to be synchronized.":
      "En attente de la synchronisation de {dependency}.",
    "Unknown error during ingestion.": "Erreur inconnue à l'ingestion.",
    "Dependency not synchronized yet ({clientUuid}): operation postponed to the next cycle.":
      "Dépendance non encore synchronisée ({clientUuid}) : opération reportée au prochain cycle.",
    "The quote does not reference any customer.": "Le devis ne référence aucun client.",
    "The payment references neither a party nor an invoice: it cannot be allocated.":
      "Ce paiement n'a ni client ni facture : impossible de savoir à quoi il correspond.",
    "The closing does not reference any session.":
      "Cette fermeture de caisse ne correspond à aucune ouverture.",
    "The data sent is incomplete or invalid.":
      "Les informations envoyées sont incomplètes ou fausses.",
    "Device not found.": "Appareil introuvable.",
  },
  ar: {
    'Entity "{entity}" is not supported by this server.':
      "العملية «{entity}» غير معروفة في التطبيق.",
    "Waiting for {dependency} to be synchronized.": "في انتظار مزامنة {dependency}.",
    "Unknown error during ingestion.": "خطأ غير معروف أثناء الاستيعاب.",
    "Dependency not synchronized yet ({clientUuid}): operation postponed to the next cycle.":
      "تبعية لم تتم مزامنتها بعد ({clientUuid}): تم تأجيل العملية إلى الدورة التالية.",
    "The quote does not reference any customer.": "عرض السعر لا يشير إلى أي عميل.",
    "The payment references neither a party nor an invoice: it cannot be allocated.":
      "الدفعة لا تشير إلى أي طرف أو فاتورة: يتعذّر تخصيصها.",
    "The closing does not reference any session.": "الإقفال لا يشير إلى أي جلسة.",
    "The data sent is incomplete or invalid.": "المعلومات المرسلة ناقصة أو غير صحيحة.",
    "Device not found.": "الجهاز غير موجود.",
  },
};
