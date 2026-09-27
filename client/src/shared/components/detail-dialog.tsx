/**
 * Detail window opened when a table row is clicked: a few labelled values, then
 * (optionally) the lines of the document.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Column } from "@/shared/components/resource-table";
import { cn } from "@/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export function DetailDialog({
  open,
  onOpenChange,
  title,
  description,
  loading,
  error,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  loading?: boolean;
  error?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm font-medium text-status-danger">{error}</p>
        ) : (
          <div className="space-y-5">{children}</div>
        )}
        {actions ? <DialogFooter>{actions}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export interface DetailField {
  label: ReactNode;
  value: ReactNode;
  /** Takes the full width (long text such as notes). */
  wide?: boolean;
}

/** Label / value pairs, two per line from `sm` upward. Empty values show a dash. */
export function DetailFields({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((field, index) => (
        <div key={index} className={cn("min-w-0", field.wide && "sm:col-span-2")}>
          <dt className="text-xs text-muted-foreground">{field.label}</dt>
          <dd className="mt-0.5 text-sm font-medium break-words">
            {field.value === null || field.value === undefined || field.value === ""
              ? "—"
              : field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Lines of a document (products, quantities, amounts) in a compact table. */
export function DetailLines<T>({
  title,
  columns,
  rows,
  rowKey,
  footer,
}: {
  title?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  footer?: ReactNode;
}) {
  const { t } = useTranslation("components");
  const alignClass = (align: Column<T>["align"]) =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title ?? t("detail.lines")}</p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {columns.map((column) => (
                <TableHead key={column.id} className={alignClass(column.align)}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {t("detail.noLines")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(alignClass(column.align), column.className)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {footer}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
