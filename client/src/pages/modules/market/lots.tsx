/** Lots et dates limites de consommation du module Marché. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { inventoryApi } from "@/entities/inventory/api";
import { marketApi, type ProductLotRow } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Quantity } from "@/shared/components/money";
import { QuantityInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const NONE = "NONE";

export default function LotsPage() {
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(search);

  const filters = { search: debounced || undefined, ...page };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.market.lots(filters),
    queryFn: () => marketApi.listLots(filters),
  });

  const columns: Column<ProductLotRow>[] = [
    {
      id: "lot",
      header: "Lot",
      cell: (row) => <span className="tabular font-medium">{row.lotNumber}</span>,
    },
    {
      id: "expiry",
      header: "Date limite",
      cell: (row) =>
        row.expiryDate ? (
          formatDate(row.expiryDate)
        ) : (
          <span className="text-muted-foreground">non datée</span>
        ),
    },
    {
      id: "quantity",
      header: "Quantité reçue",
      align: "end",
      cell: (row) => <Quantity value={row.receivedQuantity} />,
    },
    {
      id: "supplier",
      header: "Réf. fournisseur",
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.supplierRef || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lots & DLC"
        description="Suivi des lots datés ; le solde reste tenu par le stock du noyau."
      >
        {can("market.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouveau lot
          </Button>
        ) : null}
      </PageHeader>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Numéro de lot ou référence fournisseur…"
        className="sm:max-w-sm"
      />

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun lot"
        emptyDescription="Déclarez un lot pour suivre la date limite de consommation d'un article."
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
      />

      <LotDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function LotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    productId: "",
    warehouseId: NONE,
    lotNumber: "",
    expiryDate: "",
    receivedQuantity: "0",
    supplierRef: "",
  });

  const { data: products } = useQuery({
    queryKey: queryKeys.products({ market: true }),
    queryFn: () => catalogApi.listProducts({ profileType: "MARKET", limit: 50 }),
    enabled: open,
  });
  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      marketApi.createLot({
        ...form,
        warehouseId: form.warehouseId === NONE ? null : form.warehouseId,
        expiryDate: form.expiryDate || null,
      }),
    onSuccess: () => {
      toast.success("Lot enregistré.");
      void queryClient.invalidateQueries({ queryKey: ["mk", "lots"] });
      void queryClient.invalidateQueries({ queryKey: ["mk", "expiring"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau lot</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Produit" required>
            <Select
              value={form.productId}
              onValueChange={(value) => setForm({ ...form, productId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {(products?.items ?? []).map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.sku} — {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FieldGrid>
            <Field label="Numéro de lot" required>
              <Input
                value={form.lotNumber}
                onChange={(event) => setForm({ ...form, lotNumber: event.target.value })}
                required
                className="tabular"
              />
            </Field>
            <Field label="Date limite">
              <Input
                type="date"
                value={form.expiryDate}
                onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
              />
            </Field>
            <Field label="Quantité reçue">
              <QuantityInput
                value={form.receivedQuantity}
                onChange={(value) => setForm({ ...form, receivedQuantity: value })}
              />
            </Field>
            <Field label="Magasin">
              <Select
                value={form.warehouseId}
                onValueChange={(value) => setForm({ ...form, warehouseId: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Non précisé</SelectItem>
                  {(warehouses ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label="Référence fournisseur">
            <Input
              value={form.supplierRef}
              onChange={(event) => setForm({ ...form, supplierRef: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.productId || !form.lotNumber.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
