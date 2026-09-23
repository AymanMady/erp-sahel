/** État du stock par article et magasin, avec ajustement manuel. */

import { useState } from "react";
import { IconAdjustments, IconArrowsExchange } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { MOVEMENT_DIRECTIONS } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { inventoryApi, type StockFilters } from "@/entities/inventory/api";
import type { StockRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money, Quantity } from "@/shared/components/money";
import { MoneyInput, QuantityInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { StatCard } from "@/shared/components/stat-card";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { useMoneyFormatter } from "@/shared/components/money";

const ALL = "ALL";

export default function InventoryPage() {
  const { can } = useSession();
  const formatMoneyValue = useMoneyFormatter();
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState(ALL);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const debounced = useDebounced(search);

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const filters: StockFilters = {
    search: debounced || undefined,
    warehouseId: warehouseId === ALL ? null : warehouseId,
    lowStockOnly: lowStockOnly || undefined,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.stock(filters),
    queryFn: () => inventoryApi.listStock(filters),
  });

  const { data: valuation } = useQuery({
    queryKey: ["inventory-valuation", warehouseId],
    queryFn: () => inventoryApi.valuation(warehouseId === ALL ? null : warehouseId),
  });

  const columns: Column<StockRow>[] = [
    {
      id: "sku",
      header: "Référence",
      cell: (row) => <span className="tabular font-medium">{row.productSku}</span>,
    },
    {
      id: "name",
      header: "Article",
      cell: (row) => <span className="font-medium">{row.productName}</span>,
    },
    { id: "warehouse", header: "Magasin", hideOnMobile: true, cell: (row) => row.warehouseName },
    {
      id: "lot",
      header: "Lot",
      hideOnMobile: true,
      cell: (row) => row.lotNumber || <span className="text-muted-foreground">—</span>,
    },
    {
      id: "quantity",
      header: "Quantité",
      align: "end",
      cell: (row) => (
        <span
          className={
            Number(row.quantity) <= Number(row.minStock)
              ? "font-medium text-status-pending"
              : undefined
          }
        >
          <Quantity value={row.quantity} /> {row.productUnit}
        </span>
      ),
    },
    {
      id: "cost",
      header: "Coût moyen",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Money cents={row.averageCostCents} />,
    },
    {
      id: "value",
      header: "Valeur",
      align: "end",
      cell: (row) => <Money cents={Math.round(Number(row.quantity) * row.averageCostCents)} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Stock" description="Soldes par article, magasin et lot.">
        {can("inventory.write") ? (
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <IconArrowsExchange className="size-4" />
              Transfert
            </Button>
            <Button onClick={() => setAdjustOpen(true)}>
              <IconAdjustments className="size-4" />
              Mouvement manuel
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Valeur du stock"
          value={formatMoneyValue(valuation?.totalValueCents ?? 0)}
          hint="Au coût moyen pondéré"
        />
        <StatCard label="Références en stock" value={valuation?.skuCount ?? 0} />
        <StatCard
          label="Quantité totale"
          value={new Intl.NumberFormat("fr-FR").format(valuation?.totalQuantity ?? 0)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder="Article, référence, code-barres…"
          className="sm:max-w-sm"
        />
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les magasins</SelectItem>
            {(warehouses ?? []).map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="low-stock" checked={lowStockOnly} onCheckedChange={setLowStockOnly} />
          <Label htmlFor="low-stock" className="text-sm font-normal">
            Sous le seuil d'alerte
          </Label>
        </div>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun stock"
        emptyDescription="Le stock se crée par une réception d'achat ou un mouvement manuel."
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        minWidthClassName="min-w-[880px]"
      />

      <MovementDialog open={adjustOpen} onOpenChange={setAdjustOpen} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
    </div>
  );
}

/** Mouvement manuel : entrée, sortie ou ajustement d'inventaire. */
function MovementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [direction, setDirection] = useState<(typeof MOVEMENT_DIRECTIONS)[number]>("IN");
  const [quantity, setQuantity] = useState("1");
  const [unitCostCents, setUnitCostCents] = useState(0);
  const [reason, setReason] = useState("");
  const debounced = useDebounced(productSearch);

  const { data: products } = useQuery({
    queryKey: queryKeys.products({ movement: debounced }),
    queryFn: () =>
      catalogApi.listProducts({ search: debounced || undefined, isService: false, limit: 20 }),
    enabled: open,
  });
  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      inventoryApi.createMovement({
        productId,
        warehouseId,
        movementType: "ADJUSTMENT",
        direction,
        quantity,
        unitCostCents,
        reason,
      }),
    onSuccess: () => {
      toast.success("Mouvement enregistré.");
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mouvement de stock</DialogTitle>
          <DialogDescription>
            Tout mouvement est journalisé avec son motif : le solde reste auditable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Article" required>
            <SearchInput
              value={productSearch}
              onChange={setProductSearch}
              placeholder="Rechercher…"
            />
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Sélectionner un article" />
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
            <Field label="Magasin" required>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sens">
              <Select
                value={direction}
                onValueChange={(value) =>
                  setDirection(value as (typeof MOVEMENT_DIRECTIONS)[number])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Entrée (+)</SelectItem>
                  <SelectItem value="OUT">Sortie (−)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantité" required>
              <QuantityInput value={quantity} onChange={setQuantity} />
            </Field>
            <Field label="Coût unitaire" hint="Utilisé pour la valorisation des entrées.">
              <MoneyInput valueCents={unitCostCents} onChange={setUnitCostCents} />
            </Field>
          </FieldGrid>
          <Field label="Motif" required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Inventaire, casse, correction de saisie…"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productId || !warehouseId || !reason.trim()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const debounced = useDebounced(productSearch);

  const { data: products } = useQuery({
    queryKey: queryKeys.products({ transfer: debounced }),
    queryFn: () =>
      catalogApi.listProducts({ search: debounced || undefined, isService: false, limit: 20 }),
    enabled: open,
  });
  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      inventoryApi.transfer({ productId, fromWarehouseId, toWarehouseId, quantity }),
    onSuccess: () => {
      toast.success("Transfert effectué.");
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfert entre magasins</DialogTitle>
          <DialogDescription>
            La sortie et l'entrée sont enregistrées ensemble : la marchandise ne peut pas
            disparaître entre les deux.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Article" required>
            <SearchInput
              value={productSearch}
              onChange={setProductSearch}
              placeholder="Rechercher…"
            />
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Sélectionner un article" />
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
            <Field label="Magasin source" required>
              <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Magasin destination" required>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses ?? [])
                    .filter((warehouse) => warehouse.id !== fromWarehouseId)
                    .map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label="Quantité" required>
            <QuantityInput value={quantity} onChange={setQuantity} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productId || !fromWarehouseId || !toWarehouseId}
          >
            Transférer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
