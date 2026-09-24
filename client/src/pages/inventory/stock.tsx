/** Stock status by item and warehouse, with manual adjustment. */

import { useState } from "react";
import { IconAdjustments, IconArrowsExchange } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { MOVEMENT_DIRECTIONS } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { currentIntlLocale } from "@/shared/i18n";
import { catalogApi } from "@/entities/catalog/api";
import { inventoryApi, type StockFilters } from "@/entities/inventory/api";
import { onlineOrQueued, queueStockMovement } from "@/shared/offline/offline-writes";
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
  const { t } = useTranslation("inventory");
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
      header: t("common:labels.reference"),
      cell: (row) => <span className="tabular font-medium">{row.productSku}</span>,
    },
    {
      id: "name",
      header: t("movements.item"),
      cell: (row) => <span className="font-medium">{row.productName}</span>,
    },
    {
      id: "warehouse",
      header: t("common:labels.warehouse"),
      hideOnMobile: true,
      cell: (row) => row.warehouseName,
    },
    {
      id: "lot",
      header: t("stock.lot"),
      hideOnMobile: true,
      cell: (row) => row.lotNumber || <span className="text-muted-foreground">—</span>,
    },
    {
      id: "quantity",
      header: t("common:labels.quantity"),
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
      header: t("stock.averageCost"),
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Money cents={row.averageCostCents} />,
    },
    {
      id: "value",
      header: t("stock.value"),
      align: "end",
      cell: (row) => <Money cents={Math.round(Number(row.quantity) * row.averageCostCents)} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("stock.title")} description={t("stock.description")}>
        {can("inventory.write") ? (
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <IconArrowsExchange className="size-4" />
              {t("stock.transfer")}
            </Button>
            <Button onClick={() => setAdjustOpen(true)}>
              <IconAdjustments className="size-4" />
              {t("stock.manualMovement")}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("stock.stockValue")}
          value={formatMoneyValue(valuation?.totalValueCents ?? 0)}
          hint={t("stock.stockValueHint")}
        />
        <StatCard label={t("stock.skuCount")} value={valuation?.skuCount ?? 0} />
        <StatCard
          label={t("stock.totalQuantity")}
          value={new Intl.NumberFormat(currentIntlLocale()).format(valuation?.totalQuantity ?? 0)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder={t("stock.searchPlaceholder")}
          className="sm:max-w-sm"
        />
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allWarehouses")}</SelectItem>
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
            {t("stock.lowStockOnly")}
          </Label>
        </div>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("stock.emptyTitle")}
        emptyDescription={t("stock.emptyDescription")}
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

/** Manual movement: stock in, stock out or inventory adjustment. */
function MovementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("inventory");
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
      onlineOrQueued(
        () =>
          inventoryApi.createMovement({
            productId,
            warehouseId,
            movementType: "ADJUSTMENT",
            direction,
            quantity,
            unitCostCents,
            reason,
          }),
        () =>
          queueStockMovement({ productId, warehouseId, direction, quantity, unitCostCents, reason })
      ),
    onSuccess: (outcome) => {
      if (outcome.mode === "offline") {
        toast.success(t("stock.movementDialog.savedOffline"), {
          description: t("stock.movementDialog.savedOfflineDescription"),
        });
      } else {
        toast.success(t("stock.movementDialog.saved"));
      }
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
          <DialogTitle>{t("stock.movementDialog.title")}</DialogTitle>
          <DialogDescription>{t("stock.movementDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("movements.item")} required>
            <SearchInput
              value={productSearch}
              onChange={setProductSearch}
              placeholder={t("common:actions.searchEllipsis")}
            />
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder={t("stock.selectItem")} />
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
            <Field label={t("common:labels.warehouse")} required>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
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
            <Field label={t("stock.movementDialog.direction")}>
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
                  <SelectItem value="IN">{t("stock.movementDialog.in")}</SelectItem>
                  <SelectItem value="OUT">{t("stock.movementDialog.out")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("common:labels.quantity")} required>
              <QuantityInput value={quantity} onChange={setQuantity} />
            </Field>
            <Field label={t("movements.unitCost")} hint={t("stock.movementDialog.unitCostHint")}>
              <MoneyInput valueCents={unitCostCents} onChange={setUnitCostCents} />
            </Field>
          </FieldGrid>
          <Field label={t("stock.movementDialog.reason")} required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("stock.movementDialog.reasonPlaceholder")}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productId || !warehouseId || !reason.trim()}
          >
            {t("common:actions.save")}
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
  const { t } = useTranslation("inventory");
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
      toast.success(t("stock.transferDialog.done"));
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
          <DialogTitle>{t("stock.transferDialog.title")}</DialogTitle>
          <DialogDescription>{t("stock.transferDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("movements.item")} required>
            <SearchInput
              value={productSearch}
              onChange={setProductSearch}
              placeholder={t("common:actions.searchEllipsis")}
            />
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder={t("stock.selectItem")} />
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
            <Field label={t("stock.transferDialog.from")} required>
              <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
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
            <Field label={t("stock.transferDialog.to")} required>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
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
          <Field label={t("common:labels.quantity")} required>
            <QuantityInput value={quantity} onChange={setQuantity} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productId || !fromWarehouseId || !toWarehouseId}
          >
            {t("stock.transferDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
