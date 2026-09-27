/**
 * ERP list table.
 *
 * Follows the design system's visual language (grey header, rounded borders, footer
 * pagination) while adapting it to two ERP-specific constraints:
 *  - **server-side pagination**: invoice or movement lists quickly outgrow the
 *    browser's memory;
 *  - **explicit states**: loading, empty list and error each have their own
 *    rendering, because an empty table without explanation is the surest way to make
 *    people believe data was lost.
 */

import { useState, type MouseEvent, type ReactNode } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconInbox,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { DetailDialog, DetailFields } from "@/shared/components/detail-dialog";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export interface Column<T> {
  /** Technical column key (used as the React `key`). */
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Content alignment; `end` for amounts. */
  align?: "start" | "center" | "end";
  className?: string;
  /** Hides the column below `md` — useful for narrow checkout screens. */
  hideOnMobile?: boolean;
}

export interface ResourceTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /**
   * Opens the row's own detail (page or window). Without it, a click shows every column
   * of the row in a detail window, so every table row can be opened.
   */
  onRowClick?: (row: T) => void;
  /** Title of the default detail window; defaults to the first column. */
  detailTitle?: (row: T) => ReactNode;
  /** Server pagination; when omitted, the table simply shows every row. */
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    onChange: (next: { limit: number; offset: number }) => void;
  };
  /** Footer row (totals) rendered below the data. */
  footer?: ReactNode;
  /**
   * Minimum table width, prefixed with `md:` so phones are not forced into a wide
   * table: there, the table takes the width of its content and scrolls sideways.
   */
  minWidthClassName?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

/** A click on a button, link or field inside a row must not also open the row. */
const INTERACTIVE =
  "button, a, input, select, textarea, label, [role='checkbox'], [role='combobox'], [role='menuitem'], [role='switch']";

function isRowClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement;
  // Clicks inside a portal (menu, dialog) bubble through React but are not in the row.
  if (!event.currentTarget.contains(target)) return false;
  return !target.closest(INTERACTIVE);
}

export function ResourceTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  detailTitle,
  pagination,
  footer,
  minWidthClassName = "md:min-w-[720px]",
}: ResourceTableProps<T>) {
  const { t } = useTranslation("components");
  const [detailRow, setDetailRow] = useState<T | null>(null);
  const openRow = onRowClick ?? setDetailRow;
  const detailColumns = columns.filter((column) => column.id !== "actions" && column.header);
  const alignClass = (align: Column<T>["align"]) =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const page = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        {/* Without rows, no minimum width: the empty message stays centered on screen. */}
        <Table className={cn(rows.length > 0 && minWidthClassName)}>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    alignClass(column.align),
                    column.hideOnMobile && "hidden md:table-cell",
                    column.className
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(column.hideOnMobile && "hidden md:table-cell")}
                    >
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center">
                  <p className="text-sm font-medium text-status-danger">{error}</p>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <IconInbox className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      {emptyTitle ?? t("resourceTable.emptyTitle")}
                    </p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {emptyDescription ?? t("resourceTable.emptyDescription")}
                    </p>
                    {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={(event) => {
                    if (isRowClick(event)) openRow(row);
                  }}
                  className="cursor-pointer"
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        alignClass(column.align),
                        column.hideOnMobile && "hidden md:table-cell",
                        column.className
                      )}
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

      {onRowClick ? null : (
        <DetailDialog
          open={detailRow !== null}
          onOpenChange={(open) => {
            if (!open) setDetailRow(null);
          }}
          title={
            detailRow === null
              ? ""
              : detailTitle
                ? detailTitle(detailRow)
                : (detailColumns[0]?.cell(detailRow) ?? t("resourceTable.details"))
          }
        >
          {detailRow === null ? null : (
            <DetailFields
              fields={detailColumns.map((column) => ({
                label: column.header,
                value: column.cell(detailRow),
              }))}
            />
          )}
        </DetailDialog>
      )}

      {pagination ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {t("resourceTable.itemCount", { count: pagination.total })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-end">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("resourceTable.perPage")}</span>
              <Select
                value={String(pagination.limit)}
                onValueChange={(value) => pagination.onChange({ limit: Number(value), offset: 0 })}
              >
                <SelectTrigger size="sm" className="w-[76px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="tabular text-sm text-muted-foreground">
              {t("resourceTable.pageOf", { page, pageCount })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("resourceTable.firstPage")}
                onClick={() => pagination.onChange({ limit: pagination.limit, offset: 0 })}
                disabled={page <= 1}
              >
                <IconChevronsLeft className="size-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("resourceTable.previousPage")}
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: Math.max(0, pagination.offset - pagination.limit),
                  })
                }
                disabled={page <= 1}
              >
                <IconChevronLeft className="size-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("resourceTable.nextPage")}
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: pagination.offset + pagination.limit,
                  })
                }
                disabled={page >= pageCount}
              >
                <IconChevronRight className="size-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={t("resourceTable.lastPage")}
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: (pageCount - 1) * pagination.limit,
                  })
                }
                disabled={page >= pageCount}
              >
                <IconChevronsRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
