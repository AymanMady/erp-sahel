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
import { Separator } from "@/shared/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

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
  vatRateBp: number;
}

export function emptyLine(vatRateBp = 0): DocumentLine {
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
    vatRateBp,
  };
}

/** Converts editor lines to the format expected by the API. */
export function toApiLines(lines: DocumentLine[]) {
  return lines
    .filter((line) => line.description.trim() && Number(line.quantity) > 0)
    .map((line) => ({
      productId: line.productId,
      serviceId: line.serviceId,
      productSku: line.productSku,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      vatRateBp: line.vatRateBp,
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
  const { company } = useSession();
  const [pickerOpen, setPickerOpen] = useState(false);

  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      vatRateBp: line.vatRateBp,
    })),
    { globalDiscountBp, vatEnabled: company?.vatEnabled ?? true }
  );

  const update = (key: string, patch: Partial<DocumentLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const remove = (key: string) => onChange(lines.filter((line) => line.key !== key));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-[34%]">{t("lineEditor.columns.description")}</TableHead>
              <TableHead className="w-24 text-end">{t("common:labels.quantity")}</TableHead>
              <TableHead className="w-32 text-end">{t("common:labels.unitPrice")}</TableHead>
              <TableHead className="w-24 text-end">{t("common:labels.discount")}</TableHead>
              <TableHead className="w-24 text-end">{t("vat")}</TableHead>
              <TableHead className="w-32 text-end">{t("common:labels.totalExclTax")}</TableHead>
              {!readOnly ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={readOnly ? 6 : 7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {t("lineEditor.empty")}
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line, index) => (
                <TableRow key={line.key}>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(event) => update(line.key, { description: event.target.value })}
                      disabled={readOnly}
                      placeholder={t("lineEditor.descriptionPlaceholder")}
                    />
                    {line.productSku ? (
                      <p className="tabular mt-1 text-xs text-muted-foreground">
                        {line.productSku}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <QuantityInput
                      value={line.quantity}
                      onChange={(value) => update(line.key, { quantity: value })}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      valueCents={line.unitPriceCents}
                      onChange={(cents) => update(line.key, { unitPriceCents: cents })}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell>
                    <RateInput
                      valueBp={line.discountBp}
                      onChange={(bp) => update(line.key, { discountBp: bp })}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell>
                    <RateInput
                      valueBp={line.vatRateBp}
                      onChange={(bp) => update(line.key, { vatRateBp: bp })}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={totals.lines[index]?.totalHtCents ?? 0} />
                  </TableCell>
                  {!readOnly ? (
                    <TableCell className="text-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("lineEditor.removeLine")}
                        onClick={() => remove(line.key)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
            <IconPlus className="size-4" />
            {t("lineEditor.addItem")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange([...lines, emptyLine(company?.defaultVatRateBp ?? 0)])}
          >
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
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("common:labels.totalExclTax")}</span>
            <Money cents={totals.totalHtCents} />
          </div>
          {totals.vatBreakdown
            .filter((entry) => entry.vatCents !== 0)
            .map((entry) => (
              <div key={entry.vatRateBp} className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("vatRate", { rate: entry.vatRateBp / 100 })}
                </span>
                <Money cents={entry.vatCents} />
              </div>
            ))}
          <Separator className="my-2" />
          <div className="flex items-center justify-between text-base font-semibold">
            <span>{t("common:labels.totalInclTax")}</span>
            <Money cents={totals.totalTtcCents} />
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
                    ...emptyLine(product.vatRateBp),
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
                    ...emptyLine(service.vatRateBp),
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
