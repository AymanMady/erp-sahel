/** French and Arabic translations of the technical (database) messages, keyed by the English source text. */

import type { MessageCatalog } from "./types";

export const systemMessages: MessageCatalog = {
  fr: {
    "This file is not a backup of the application.":
      "Ce fichier n'est pas une sauvegarde de l'application.",
    "This backup was made by another version of the application.":
      "Cette sauvegarde a été faite par une autre version de l'application.",
    "This backup was made with another version of the database. Restore it on the same version of the application.":
      "Cette sauvegarde a été faite avec une autre version de la base. Remettez-la sur la même version de l'application.",
    "This backup contains tables this application does not know: {tables}.":
      "Cette sauvegarde contient des tables que l'application ne connaît pas : {tables}.",
    "Choose a backup file.": "Choisissez un fichier de sauvegarde.",
    "This backup is incomplete: some data points to data that is missing ({link}).":
      "Cette sauvegarde est incomplète : certaines données renvoient à des données absentes ({link}).",
    "The password of this account is set in the server configuration (SUPERADMIN_PASSWORD).":
      "Le mot de passe de ce compte se change dans la configuration du serveur (SUPERADMIN_PASSWORD).",
  },
  ar: {
    "This file is not a backup of the application.": "هذا الملف ليس نسخة احتياطية من التطبيق.",
    "This backup was made by another version of the application.":
      "تم إنشاء هذه النسخة الاحتياطية بإصدار آخر من التطبيق.",
    "This backup was made with another version of the database. Restore it on the same version of the application.":
      "تم إنشاء هذه النسخة الاحتياطية بإصدار آخر من قاعدة البيانات. استعدها على نفس إصدار التطبيق.",
    "This backup contains tables this application does not know: {tables}.":
      "تحتوي هذه النسخة الاحتياطية على جداول لا يعرفها التطبيق: {tables}.",
    "Choose a backup file.": "اختر ملف النسخة الاحتياطية.",
    "This backup is incomplete: some data points to data that is missing ({link}).":
      "هذه النسخة الاحتياطية ناقصة: بعض البيانات تشير إلى بيانات غير موجودة ({link}).",
    "The password of this account is set in the server configuration (SUPERADMIN_PASSWORD).":
      "تُغيَّر كلمة مرور هذا الحساب في إعدادات الخادم (SUPERADMIN_PASSWORD).",
  },
};
