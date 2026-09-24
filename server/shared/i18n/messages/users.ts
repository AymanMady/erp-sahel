/** French and Arabic translations of the users messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const usersMessages: MessageCatalog = {
  fr: {
    "At least 3 characters": "3 caractères minimum",
    "Invalid email address": "Adresse e-mail invalide",
    "Name is required": "Le nom est obligatoire",
    "Invalid identifier": "Identifiant invalide",
    "User not found.": "Utilisateur introuvable.",
    "User not found in this company.": "Utilisateur introuvable dans cette société.",
    "You cannot deactivate your own account.": "Vous ne pouvez pas désactiver votre propre compte.",
    "Role not found.": "Rôle introuvable.",
    "A system role cannot be modified. Duplicate it to adapt it.":
      "Un rôle système ne peut pas être modifié. Dupliquez-le pour l'adapter.",
    "A system role cannot be deleted.": "Un rôle système ne peut pas être supprimé.",
    "This role is assigned to {count} user(s): remove it first.":
      "Ce rôle est affecté à {count} utilisateur(s) : retirez-le d'abord.",
  },
  ar: {
    "At least 3 characters": "3 أحرف على الأقل",
    "Invalid email address": "عنوان البريد الإلكتروني غير صالح",
    "Name is required": "الاسم مطلوب",
    "Invalid identifier": "معرّف غير صالح",
    "User not found.": "المستخدم غير موجود.",
    "User not found in this company.": "المستخدم غير موجود في هذه الشركة.",
    "You cannot deactivate your own account.": "لا يمكنك تعطيل حسابك الخاص.",
    "Role not found.": "الدور غير موجود.",
    "A system role cannot be modified. Duplicate it to adapt it.":
      "لا يمكن تعديل دور النظام. انسخه لتكييفه.",
    "A system role cannot be deleted.": "لا يمكن حذف دور النظام.",
    "This role is assigned to {count} user(s): remove it first.":
      "هذا الدور مسند إلى {count} مستخدم(ين): أزله أولًا.",
  },
};
