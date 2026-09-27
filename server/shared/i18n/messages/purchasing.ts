/** French and Arabic translations of the purchasing messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const purchasingMessages: MessageCatalog = {
  fr: {
    "Purchase order not found.": "Commande d'achat introuvable.",
    "A received or cancelled order can no longer be modified.":
      "Une commande reçue ou annulée ne peut plus être modifiée.",
    "Specify the supplier of this receipt.": "Indiquez le fournisseur de cette réception.",
    "Supplier invoice {number}": "Facture fournisseur {number}",
    "Select a supplier": "Sélectionnez un fournisseur",
    "Add at least one line": "Ajoutez au moins une ligne",
    "Specify at least one received item": "Indiquez au moins un produit reçu",
    "Invalid identifier": "Identifiant invalide",
    "Some goods of this order have already arrived. You can no longer change its items, its discount or its supplier.":
      "Une partie des marchandises de cette commande est déjà arrivée. Vous ne pouvez plus changer ses produits, sa remise ou son fournisseur.",
    "An order becomes received only when you record the goods that arrived.":
      "Une commande devient « reçue » seulement quand vous enregistrez les marchandises arrivées.",
    "Goods of this order have already arrived, or it was cancelled. Its state can no longer be changed.":
      "Des marchandises de cette commande sont déjà arrivées, ou elle a été annulée. Son état ne peut plus être changé.",
    "This order was cancelled. Its goods can no longer be received.":
      "Cette commande a été annulée. Ses marchandises ne peuvent plus être reçues.",
    "All the goods of this order have already been received.":
      "Toutes les marchandises de cette commande ont déjà été reçues.",
    "Line {line}: this item is not on the order.":
      "Ligne {line} : ce produit n'est pas dans la commande.",
    "{item}: only {remaining} left to receive on this order, but {requested} was entered.":
      "{item} : il reste seulement {remaining} à recevoir sur cette commande, mais vous avez saisi {requested}.",
    "Goods receipt not found.": "Réception introuvable.",
    "Supplier invoice not found.": "Facture fournisseur introuvable.",
    "This supplier invoice is not validated or was cancelled: it cannot be paid.":
      "Cette facture fournisseur n'est pas validée ou a été annulée : elle ne peut pas être payée.",
    "This payment is more than what is still owed to the supplier ({amount}).":
      "Ce paiement dépasse ce qui reste à payer au fournisseur ({amount}).",
    "You cannot take back more than what was paid on this invoice.":
      "Vous ne pouvez pas reprendre plus que ce qui a été payé sur cette facture.",
  },
  ar: {
    "Purchase order not found.": "أمر الشراء غير موجود.",
    "A received or cancelled order can no longer be modified.":
      "لا يمكن تعديل طلبية مستلمة أو ملغاة.",
    "Specify the supplier of this receipt.": "حدد مورد هذا الاستلام.",
    "Supplier invoice {number}": "فاتورة المورد {number}",
    "Select a supplier": "اختر موردًا",
    "Add at least one line": "أضف سطرًا واحدًا على الأقل",
    "Specify at least one received item": "حدد منتجًا مستلمًا واحدًا على الأقل",
    "Invalid identifier": "معرّف غير صالح",
    "Some goods of this order have already arrived. You can no longer change its items, its discount or its supplier.":
      "وصل جزء من بضاعة هذه الطلبية. لم يعد بإمكانك تغيير منتجاتها أو تخفيضها أو موردها.",
    "An order becomes received only when you record the goods that arrived.":
      "تصبح الطلبية «مستلمة» فقط عندما تسجل البضاعة التي وصلت.",
    "Goods of this order have already arrived, or it was cancelled. Its state can no longer be changed.":
      "وصلت بضاعة من هذه الطلبية أو تم إلغاؤها. لم يعد بالإمكان تغيير حالتها.",
    "This order was cancelled. Its goods can no longer be received.":
      "تم إلغاء هذه الطلبية. لم يعد بالإمكان استلام بضاعتها.",
    "All the goods of this order have already been received.": "تم استلام كل بضاعة هذه الطلبية.",
    "Line {line}: this item is not on the order.": "السطر {line}: هذا المنتج ليس في الطلبية.",
    "{item}: only {remaining} left to receive on this order, but {requested} was entered.":
      "{item}: بقي {remaining} فقط للاستلام في هذه الطلبية، لكنك أدخلت {requested}.",
    "Goods receipt not found.": "الاستلام غير موجود.",
    "Supplier invoice not found.": "فاتورة المورد غير موجودة.",
    "This supplier invoice is not validated or was cancelled: it cannot be paid.":
      "فاتورة المورد هذه غير مصادق عليها أو ملغاة: لا يمكن دفعها.",
    "This payment is more than what is still owed to the supplier ({amount}).":
      "هذا الدفع أكثر مما بقي للمورد ({amount}).",
    "You cannot take back more than what was paid on this invoice.":
      "لا يمكنك استرجاع أكثر مما دُفع على هذه الفاتورة.",
  },
};
