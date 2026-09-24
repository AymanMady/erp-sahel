"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

/**
 * Controlled delete-confirmation dialog. Drive `open`/`onOpenChange` from the
 * caller (e.g. a dropdown menu item sets open=true). `onConfirm` runs the
 * actual removal; a success toast is shown automatically.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  name,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm?: () => void;
  name?: string;
  description?: string;
}) {
  const { t } = useTranslation("components");
  const itemName = name ?? t("deleteDialog.defaultName");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteDialog.title", { name: itemName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? t("deleteDialog.description", { name: itemName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => {
              onConfirm?.();
              toast.success(t("deleteDialog.deleted", { name: itemName }), {
                description: t("deleteDialog.deletedDescription"),
              });
            }}
          >
            {t("common:actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
