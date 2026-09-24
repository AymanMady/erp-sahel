/** Stock report: valuation and stock-outs. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import { reportsApi } from "@/entities/reports/api";
import { currentIntlLocale } from "@/shared/i18n";
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
  const { t } = useTranslation("reports");
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
      header: t("common:labels.reference"),
      cell: (row) => <span className="tabular font-medium">{row.sku}</span>,
    },
    { id: "name", header: t("stock.columns.item"), cell: (row) => row.name },
    {
      id: "quantity",
      header: t("stock.columns.currentStock"),
      align: "end",
      cell: (row) => (
        <span className="text-status-pending">
          <Quantity value={row.quantity} />
        </span>
      ),
    },
    {
      id: "min",
      header: t("stock.columns.alertThreshold"),
      align: "end",
      cell: (row) => <Quantity value={row.minStock} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("stock.title")} description={t("stock.description")}>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("stock.allWarehouses")}</SelectItem>
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
          label={t("stock.stockValue")}
          value={formatMoneyValue(data?.valuation.totalValueCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label={t("stock.skus")}
          value={data?.valuation.skuCount ?? 0}
          loading={isLoading}
        />
        <StatCard
          label={t("stock.totalQuantity")}
          value={new Intl.NumberFormat(currentIntlLocale()).format(
            data?.valuation.totalQuantity ?? 0
          )}
          loading={isLoading}
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t("stock.belowThreshold")}</h2>
        <ResourceTable
          columns={columns}
          rows={data?.lowStock ?? []}
          rowKey={(row) => row.productId}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          emptyTitle={t("stock.emptyTitle")}
          emptyDescription={t("stock.emptyDescription")}
        />
      </div>
    </div>
  );
}
