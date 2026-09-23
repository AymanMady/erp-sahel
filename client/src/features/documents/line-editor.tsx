/**
 * Éditeur de lignes de document, partagé par les devis, commandes, factures et
 * commandes d'achat.
 *
 * Il existe parce que ces quatre documents ont **exactement** la même grille de saisie :
 * la dupliquer garantirait qu'un jour les remises se calculent différemment sur un
 * devis et sur la facture qui en découle.
 */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { computeDocumentTotals } from "@shared/pricing";
import { catalogApi } from "@/entities/catalog/api";
import { settingsApi } from "@/entities/settings/api";
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
  /** Identifiant local de la ligne, pour les clés React. */
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
    unit: "unité",
    unitPriceCents: 0,
    discountBp: 0,
    vatRateBp,
  };
}

/** Convertit les lignes de l'éditeur vers le format attendu par l'API. */
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
  /** Achat : on propose le prix d'achat plutôt que le prix de vente. */
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
              <TableHead className="w-[34%]">Désignation</TableHead>
              <TableHead className="w-24 text-end">Quantité</TableHead>
              <TableHead className="w-32 text-end">Prix unitaire</TableHead>
              <TableHead className="w-24 text-end">Remise</TableHead>
              <TableHead className="w-24 text-end">TVA</TableHead>
              <TableHead className="w-32 text-end">Total HT</TableHead>
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
                  Aucune ligne. Ajoutez un article ou une prestation.
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
                      placeholder="Désignation de la ligne"
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
                        aria-label="Supprimer la ligne"
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
            Ajouter un article
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange([...lines, emptyLine(company?.defaultVatRateBp ?? 0)])}
          >
            Ligne libre
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          {onGlobalDiscountChange && !readOnly ? (
            <div className="flex items-center justify-between gap-3 pb-2">
              <span className="text-muted-foreground">Remise globale</span>
              <div className="w-24">
                <RateInput valueBp={globalDiscountBp} onChange={onGlobalDiscountChange} />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total HT</span>
            <Money cents={totals.totalHtCents} />
          </div>
          {totals.vatBreakdown
            .filter((entry) => entry.vatCents !== 0)
            .map((entry) => (
              <div key={entry.vatRateBp} className="flex items-center justify-between">
                <span className="text-muted-foreground">TVA {entry.vatRateBp / 100} %</span>
                <Money cents={entry.vatCents} />
              </div>
            ))}
          <Separator className="my-2" />
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total TTC</span>
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

/** Sélecteur d'article ou de prestation, avec recherche serveur. */
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
          <DialogTitle>Ajouter une ligne</DialogTitle>
          <DialogDescription>
            Le prix et le taux de TVA sont repris du catalogue ; ils restent modifiables.
          </DialogDescription>
        </DialogHeader>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Article ou prestation…"
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
                    {product.isService ? " · prestation" : ` · stock ${product.stockQuantity ?? 0}`}
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
                    unit: "prestation",
                    unitPriceCents: service.priceCents,
                  })
                }
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{service.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {service.code} · prestation
                  </p>
                </div>
                <Money cents={service.priceCents} className="shrink-0 text-sm" />
              </button>
            ))}

            {(products?.items.length ?? 0) === 0 && (services?.items.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucun résultat.</p>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
