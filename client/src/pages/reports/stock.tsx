/** Rapport de stock : valorisation et ruptures. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import { reportsApi } from "@/entities/reports/api";
import { queryKeys } from "@/shared/api/query-client";
import { Quantity, useMoneyFormatter } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatCard } from "@/shared/components/stat-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  minStock: string;
  quantity: string;
}

export default function StockReportPage() {
  const formatMoneyValue = useMoneyFormatter();
  const [warehouseId, setWarehouseId] = useState(ALL);

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.reports("stock", warehouseId),
    queryFn: () => reportsApi.stock(warehouseId === ALL ? null : warehouseId),
  });

  const columns: Column<LowStockRow>[] = [
    {
      id: "sku",
      header: "Référence",
      cell: (row) => <span className="tabular font-medium">{row.sku}</span>,
    },
    { id: "name", header: "Article", cell: (row) => row.name },
    {
      id: "quantity",
      header: "Stock actuel",
      align: "end",
      cell: (row) => (
        <span className="text-status-pending">
          <Quantity value={row.quantity} />
        </span>
      ),
    },
    {
      id: "min",
      header: "Seuil d'alerte",
      align: "end",
      cell: (row) => <Quantity value={row.minStock} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapport de stock"
        description="Valorisation au coût moyen et alertes de rupture."
      >
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-[220px]">
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
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Valeur du stock"
          value={formatMoneyValue(data?.valuation.totalValueCents ?? 0)}
          loading={isLoading}
        />
        <StatCard label="Références" value={data?.valuation.skuCount ?? 0} loading={isLoading} />
        <StatCard
          label="Quantité totale"
          value={new Intl.NumberFormat("fr-FR").format(data?.valuation.totalQuantity ?? 0)}
          loading={isLoading}
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Articles sous le seuil d'alerte</h2>
        <ResourceTable
          columns={columns}
          rows={data?.lowStock ?? []}
          rowKey={(row) => row.productId}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          emptyTitle="Aucune alerte"
          emptyDescription="Tous les articles suivis sont au-dessus de leur seuil de réapprovisionnement."
        />
      </div>
    </div>
  );
}
