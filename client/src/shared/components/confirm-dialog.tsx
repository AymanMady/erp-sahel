/**
 * Confirmation before an action that cannot be undone (validate an invoice, archive,
 * cancel an order…). The question is written in plain words and, when money is
 * involved, gives the amount: « Valider la facture de 12 500 MRU ? Elle ne pourra plus
 * être modifiée. »
 *
 * Usage:
 *   const [confirmDialog, confirm] = useConfirm();
 *   if (await confirm({ title, description })) mutation.mutate();
 *   …
 *   {confirmDialog}
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { i18n } from "@/shared/i18n";
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

export interface ConfirmOptions {
  /** The question, e.g. "Archive the category Drinks?". */
  title: string;
  /** What will happen, in plain words. */
  description?: ReactNode;
  /** Label of the confirmation button (default: "Confirm"). */
  confirmLabel?: string;
  /** Red button: the action removes or cancels something. */
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive,
}: ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel ?? t("common:actions.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Asks a question and waits for the answer: resolves `true` on confirmation, `false`
 * when the person cancels or closes the dialog. Render the returned element once.
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A question still open is answered "no" before asking the new one.
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const element = options ? (
    <ConfirmDialog
      {...options}
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return [element, confirm];
}

/** Question asked before taking something out of the lists (archiving). */
export function archiveQuestion(name: string): ConfirmOptions {
  return {
    title: i18n.t("common:confirm.archive.title", { name }),
    description: i18n.t("common:confirm.archive.description"),
    confirmLabel: i18n.t("common:confirm.archive.confirm"),
    destructive: true,
  };
}
