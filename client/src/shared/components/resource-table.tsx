/**
 * Tableau de liste de l'ERP.
 *
 * Reprend le langage visuel du design system (en-tête gris, bordures arrondies,
 * pagination en pied) en l'adaptant à deux contraintes propres à un ERP :
 *  - **pagination côté serveur** : les listes de factures ou de mouvements dépassent
 *    vite la mémoire du navigateur ;
 *  - **états explicites** : chargement, liste vide et erreur ont chacun leur rendu,
 *    parce qu'un tableau vide sans explication est le meilleur moyen de faire croire
 *    à une perte de données.
 */

import type { ReactNode } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconInbox,
} from "@tabler/icons-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export interface Column<T> {
  /** Clé technique de la colonne (sert de `key` React). */
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Alignement du contenu ; `end` pour les montants. */
  align?: "start" | "center" | "end";
  className?: string;
  /** Masque la colonne sous `md` — utile pour les écrans de caisse étroits. */
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
  onRowClick?: (row: T) => void;
  /** Pagination serveur ; omise, le tableau affiche simplement toutes les lignes. */
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    onChange: (next: { limit: number; offset: number }) => void;
  };
  /** Ligne de pied (totaux) rendue sous les données. */
  footer?: ReactNode;
  minWidthClassName?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function ResourceTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyTitle = "Aucun résultat",
  emptyDescription = "Aucun élément ne correspond à votre recherche.",
  emptyAction,
  onRowClick,
  pagination,
  footer,
  minWidthClassName = "min-w-[720px]",
}: ResourceTableProps<T>) {
  const alignClass = (align: Column<T>["align"]) =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const page = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table className={minWidthClassName}>
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
            ) : error ? (
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
                    <p className="text-sm font-medium">{emptyTitle}</p>
                    <p className="max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
                    {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
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

      {pagination ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <span className="tabular">{pagination.total}</span> élément
            {pagination.total > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-end">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Par page</span>
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
              Page {page} / {pageCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Première page"
                onClick={() => pagination.onChange({ limit: pagination.limit, offset: 0 })}
                disabled={page <= 1}
              >
                <IconChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Page précédente"
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: Math.max(0, pagination.offset - pagination.limit),
                  })
                }
                disabled={page <= 1}
              >
                <IconChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Page suivante"
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: pagination.offset + pagination.limit,
                  })
                }
                disabled={page >= pageCount}
              >
                <IconChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Dernière page"
                onClick={() =>
                  pagination.onChange({
                    limit: pagination.limit,
                    offset: (pageCount - 1) * pagination.limit,
                  })
                }
                disabled={page >= pageCount}
              >
                <IconChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
