/**
 * Document line editor, shared by quotes, sales orders, invoices and purchase orders.
 *
 * It exists because these four documents have **exactly** the same entry grid:
 * duplicating it would guarantee that one day discounts are computed differently on
 * a quote and on the invoice that stems from it.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { computeDocumentTotals } from "@shared/pricing";
import { catalogApi } from "@/entities/catalog/api";
import { settingsApi } from "@/entities/settings/api";
import { i18n } from "@/shared/i18n";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Money } from "@/shared/components/money";
import { MoneyInput, QuantityInput, RateInput } from "@/shared/components/money-input";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

export interface DocumentLine {
  /** Local line identifier, used for React keys. */
  key: string;
  productId: string | null;
  serviceId: string | null;
  productSku: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  discountBp: number;
}

export function emptyLine(): DocumentLine {
  return {
    key: Math.random().toString(36).slice(2),
    productId: null,
    serviceId: null,
    productSku: "",
    description: "",
    quantity: "1",
    // Default unit, written in the current UI language (stored on the document).
    unit: i18n.t("documents:units.unit"),
    unitPriceCents: 0,
    discountBp: 0,
  };
}

/** A line is kept only with a name and a quantity above 0. */
function isComplete(line: DocumentLine): boolean {
  return Boolean(line.description.trim()) && Number(line.quantity) > 0;
}

/** Something was typed or picked on the line: leaving it out must be said. */
function isStarted(line: DocumentLine): boolean {
  return (
    Boolean(line.description.trim() || line.productId || line.serviceId) || line.unitPriceCents > 0
  );
}

/** Why a line will not be saved, or `null` when it will be. */
function lineProblem(line: DocumentLine): "name" | "quantity" | null {
  if (!line.description.trim()) return "name";
  if (!(Number(line.quantity) > 0)) return "quantity";
  return null;
}

/**
 * Why the save button of a document is greyed out, in plain words — or `null` when
 * the document can be saved. Shown next to the button so nobody is left guessing.
 */
export function documentBlocker(input: {
  party: unknown;
  lines: DocumentLine[];
  partyRole?: "customer" | "supplier";
}): string | null {
  if (!input.party) {
    return i18n.t(
      input.partyRole === "supplier"
        ? "documents:lineEditor.blockers.noSupplier"
        : "documents:lineEditor.blockers.noCustomer"
    );
  }
  if (!input.lines.some(isComplete)) return i18n.t("documents:lineEditor.blockers.noLine");
  return null;
}

/** Converts editor lines to the format expected by the API (incomplete lines left out). */
export function toApiLines(lines: DocumentLine[]) {
  return lines.filter(isComplete).map((line) => ({
    productId: line.productId,
    serviceId: line.serviceId,
    productSku: line.productSku,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    discountBp: line.discountBp,
  }));
}

export function LineEditor({
  lines,
  onChange,
  globalDiscountBp = 0,
  onGlobalDiscountChange,
  /** Purchasing: suggest the purchase price rather than the sale price. */
  usePurchasePrice = false,
  readOnly = false,
}: {
  lines: DocumentLine[];
  onChange: (lines: DocumentLine[]) => void;
  globalDiscountBp?: number;
  onGlobalDiscountChange?: (bp: number) => void;
  usePurchasePrice?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("documents");
  const { can } = useSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  // On a sale, only someone allowed to manage the catalog may change the price of a
  // catalog item (the server refuses it otherwise). Hand-written lines keep a free price.
  const catalogPriceLocked = !usePurchasePrice && !can("catalog.write");

  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
    })),
    { globalDiscountBp }
  );

  const update = (key: string, patch: Partial<DocumentLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const remove = (key: string) => onChange(lines.filter((line) => line.key !== key));

  // Lines that will not be saved: said on the line itself and above the total,
  // instead of disappearing silently when the document is saved.
  const ignoredCount = readOnly ? 0 : lines.filter((line) => !isComplete(line)).length;
  const showIgnored = ignoredCount > 0 && lines.some((line) => isComplete(line) || isStarted(line));
  // Same columns for the header and the lines, from tablet width upward. On a phone
  // each line is a card with its own labels: no sideways scrolling.
  const columns = cn(
    "md:grid md:items-start md:gap-3",
    readOnly
      ? "md:grid-cols-[minmax(10rem,1fr)_6rem_8rem_6rem_8rem]"
      : "md:grid-cols-[minmax(10rem,1fr)_6rem_8rem_6rem_8rem_2.5rem]"
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div
          className={cn(
            "hidden border-b bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground",
            columns
          )}
        >
          <span>{t("lineEditor.columns.description")}</span>
          <span className="text-end">{t("common:labels.quantity")}</span>
          <span className="text-end">{t("common:labels.unitPrice")}</span>
          <span className="text-end">{t("common:labels.discount")}</span>
          <span className="text-end">{t("common:labels.total")}</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t("lineEditor.empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {lines.map((line, index) => {
              const problem = readOnly || !isStarted(line) ? null : lineProblem(line);
              return (
                <li key={line.key} className={cn("grid grid-cols-2 gap-3 p-3", columns)}>
                  <div className="col-span-2 md:col-span-1">
                    <Input
                      value={line.description}
                      onChange={(event) => update(line.key, { description: event.target.value })}
                      disabled={readOnly}
                      aria-label={t("lineEditor.columns.description")}
                      placeholder={t("lineEditor.descriptionPlaceholder")}
                    />
                    {line.productSku ? (
                      <p className="tabular mt-1 text-xs text-muted-foreground">
                        {line.productSku}
                      </p>
                    ) : null}
                    {problem ? (
                      <p className="mt-1 text-xs font-medium text-destructive">
                        {t(`lineEditor.problems.${problem}`)}
                      </p>
                    ) : null}
                  </div>
                  <LineField label={t("common:labels.quantity")}>
                    <QuantityInput
                      value={line.quantity}
                      onChange={(value) => update(line.key, { quantity: value })}
                      disabled={readOnly}
                    />
                  </LineField>
                  <LineField label={t("common:labels.unitPrice")}>
                    <MoneyInput
                      valueCents={line.unitPriceCents}
                      onChange={(cents) => update(line.key, { unitPriceCents: cents })}
                      disabled={
                        readOnly ||
                        (catalogPriceLocked && Boolean(line.productId || line.serviceId))
                      }
                    />
                  </LineField>
                  <LineField label={t("common:labels.discount")}>
                    <RateInput
                      valueBp={line.discountBp}
                      onChange={(bp) => update(line.key, { discountBp: bp })}
                      disabled={readOnly}
                    />
                  </LineField>
                  <LineField label={t("common:labels.total")}>
                    <Money
                      cents={totals.lines[index]?.totalCents ?? 0}
                      className="block py-2 text-end font-medium"
                    />
                  </LineField>
                  {!readOnly ? (
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("lineEditor.removeLine")}
                        onClick={() => remove(line.key)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showIgnored ? (
        <p role="status" className="text-sm text-destructive">
          {t("lineEditor.ignoredLines", { count: ignoredCount })}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
            <IconPlus className="size-4" />
            {t("lineEditor.addItem")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onChange([...lines, emptyLine()])}>
            {t("lineEditor.freeLine")}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          {onGlobalDiscountChange && !readOnly ? (
            <div className="flex items-center justify-between gap-3 pb-2">
              <span className="text-muted-foreground">{t("lineEditor.globalDiscount")}</span>
              <div className="w-24">
                <RateInput valueBp={globalDiscountBp} onChange={onGlobalDiscountChange} />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-base font-semibold">
            <span>{t("common:labels.total")}</span>
            <Money cents={totals.totalCents} />
          </div>
        </div>
      </div>

      <ProductPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        usePurchasePrice={usePurchasePrice}
        onPick={(line) => {
          onChange([...lines, line]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/** One value of a line; its label is only shown on a phone (the header row says it otherwise). */
function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 md:space-y-0">
      <span className="text-xs text-muted-foreground md:hidden">{label}</span>
      {children}
    </label>
  );
}

/** Item or service picker, with server-side search. */
function ProductPicker({
  open,
  onOpenChange,
  onPick,
  usePurchasePrice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (line: DocumentLine) => void;
  usePurchasePrice: boolean;
}) {
  const { t } = useTranslation("documents");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const { data: products } = useQuery({
    queryKey: queryKeys.products({ picker: debounced }),
    queryFn: () =>
      catalogApi.listProducts({ search: debounced || undefined, withStock: true, limit: 25 }),
    enabled: open,
  });
  const { data: services } = useQuery({
    queryKey: queryKeys.services({ picker: debounced }),
    queryFn: () => settingsApi.listServices({ search: debounced || undefined, limit: 25 }),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("productPicker.title")}</DialogTitle>
          <DialogDescription>{t("productPicker.description")}</DialogDescription>
        </DialogHeader>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("productPicker.searchPlaceholder")}
          autoFocus
        />

        <ScrollArea className="max-h-80">
          <div className="space-y-1">
            {(products?.items ?? []).map((product) => (
              <button
                key={product.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start transition-colors hover:bg-muted"
                onClick={() =>
                  onPick({
                    ...emptyLine(),
                    productId: product.id,
                    productSku: product.sku,
                    description: product.name,
                    unit: product.unit,
                    unitPriceCents: usePurchasePrice
                      ? product.purchasePriceCents
                      : product.salePriceCents,
                  })
                }
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {product.sku}
                    {product.isService
                      ? ` · ${t("productPicker.service")}`
                      : ` · ${t("productPicker.stock", { quantity: product.stockQuantity ?? 0 })}`}
                  </p>
                </div>
                <Money
                  cents={usePurchasePrice ? product.purchasePriceCents : product.salePriceCents}
                  className="shrink-0 text-sm"
                />
              </button>
            ))}

            {(services?.items ?? []).map((service) => (
              <button
                key={service.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start transition-colors hover:bg-muted"
                onClick={() =>
                  onPick({
                    ...emptyLine(),
                    serviceId: service.id,
                    productSku: service.code,
                    description: service.name,
                    unit: t("units.service"),
                    unitPriceCents: service.priceCents,
                  })
                }
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{service.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {service.code} · {t("productPicker.service")}
                  </p>
                </div>
                <Money cents={service.priceCents} className="shrink-0 text-sm" />
              </button>
            ))}

            {(products?.items.length ?? 0) === 0 && (services?.items.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("common:states.noResults")}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
