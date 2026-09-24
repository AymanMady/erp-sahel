/** French and Arabic translations of the auth messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const authMessages: MessageCatalog = {
  fr: {
    "You do not have access to this company.": "Vous n'avez pas accès à cette société.",
    "No company is linked to this account.": "Aucune société n'est rattachée à ce compte.",
    "Account not found or disabled.": "Compte introuvable ou désactivé.",
    "Incorrect username or password.": "Identifiant ou mot de passe incorrect.",
    "Session expired, please sign in again.": "Session expirée, reconnectez-vous.",
    "Session expired": "Session expirée",
    "Invalid token": "Jeton invalide",
    "You do not have permission to perform this action.":
      "Vous n'avez pas la permission d'effectuer cette action.",
    "This action is restricted to platform administrators.":
      "Action réservée à l'administration de la plateforme.",
    "Username is required": "Identifiant requis",
    "Password is required": "Mot de passe requis",
    "At least 8 characters": "8 caractères minimum",
    "The password must contain at least one letter":
      "Le mot de passe doit contenir au moins une lettre",
    "The password must contain at least one digit":
      "Le mot de passe doit contenir au moins un chiffre",
    "The confirmation does not match": "La confirmation ne correspond pas",
    "Current password is incorrect.": "Mot de passe actuel incorrect.",
    "The new password must differ from the current one.":
      "Le nouveau mot de passe doit différer de l'actuel.",
  },
  ar: {
    "You do not have access to this company.": "ليست لديك صلاحية الوصول إلى هذه الشركة.",
    "No company is linked to this account.": "لا توجد شركة مرتبطة بهذا الحساب.",
    "Account not found or disabled.": "الحساب غير موجود أو معطّل.",
    "Incorrect username or password.": "اسم المستخدم أو كلمة المرور غير صحيحة.",
    "Session expired, please sign in again.": "انتهت الجلسة، يرجى تسجيل الدخول من جديد.",
    "Session expired": "انتهت الجلسة",
    "Invalid token": "رمز غير صالح",
    "You do not have permission to perform this action.": "ليست لديك صلاحية تنفيذ هذا الإجراء.",
    "This action is restricted to platform administrators.": "هذا الإجراء مقصور على إدارة المنصة.",
    "Username is required": "اسم المستخدم مطلوب",
    "Password is required": "كلمة المرور مطلوبة",
    "At least 8 characters": "8 أحرف على الأقل",
    "The password must contain at least one letter":
      "يجب أن تحتوي كلمة المرور على حرف واحد على الأقل",
    "The password must contain at least one digit":
      "يجب أن تحتوي كلمة المرور على رقم واحد على الأقل",
    "The confirmation does not match": "التأكيد غير مطابق",
    "Current password is incorrect.": "كلمة المرور الحالية غير صحيحة.",
    "The new password must differ from the current one.":
      "يجب أن تختلف كلمة المرور الجديدة عن الحالية.",
  },
};
