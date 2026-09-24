/** Stock movement journal — the auditable source of truth for balances. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi, type MovementFilters } from "@/entities/inventory/api";
import type { MovementRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money, Quantity } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { movementLabel } from "@/shared/components/status-badge";
import { Badge } from "@/shared/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

/** Translation keys (inventory namespace) for each movement origin. */
const ORIGIN_LABEL_KEYS: Record<string, string> = {
  purchase_receipt: "movements.origins.purchaseReceipt",
  sales_invoice: "movements.origins.salesInvoice",
  credit_note: "movements.origins.creditNote",
  pos_ticket: "movements.origins.posTicket",
  manual: "movements.origins.manual",
  inventory_count: "movements.origins.inventoryCount",
  transfer: "movements.origins.transfer",
};

export default function MovementsPage() {
  const { t } = useTranslation("inventory");
  const [warehouseId, setWarehouseId] = useState(ALL);
  const [originType, setOriginType] = useState(ALL);
  const [page, setPage] = useState({ limit: 25, offset: 0 });

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const filters: MovementFilters = {
    warehouseId: warehouseId === ALL ? null : warehouseId,
    originType: originType === ALL ? null : originType,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.movements(filters),
    queryFn: () => inventoryApi.listMovements(filters),
  });

  const columns: Column<MovementRow>[] = [
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDateTime(row.createdAt) },
    {
      id: "product",
      header: t("movements.item"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          <p className="tabular text-xs text-muted-foreground">{row.productSku}</p>
        </div>
      ),
    },
    {
      id: "warehouse",
      header: t("common:labels.warehouse"),
      hideOnMobile: true,
      cell: (row) => row.warehouseName,
    },
    {
      id: "type",
      header: t("common:labels.type"),
      cell: (row) => (
        <Badge
          variant="outline"
          className={row.direction === "IN" ? "text-status-success" : "text-status-danger"}
        >
          {movementLabel(row.movementType)}
        </Badge>
      ),
    },
    {
      id: "origin",
      header: t("movements.origin"),
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          <p>
            {ORIGIN_LABEL_KEYS[row.originType]
              ? t(ORIGIN_LABEL_KEYS[row.originType])
              : row.originType}
          </p>
          {row.reference ? (
            <p className="tabular text-xs text-muted-foreground">{row.reference}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "quantity",
      header: t("common:labels.quantity"),
      align: "end",
      cell: (row) => (
        <span className={row.direction === "IN" ? "text-status-success" : "text-status-danger"}>
          {row.direction === "IN" ? "+" : "−"}
          <Quantity value={row.quantity} />
        </span>
      ),
    },
    {
      id: "balance",
      header: t("movements.balanceAfter"),
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Quantity value={row.balanceAfter} />,
    },
    {
      id: "cost",
      header: t("movements.unitCost"),
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Money cents={row.unitCostCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("movements.title")} description={t("movements.description")} />

      <div className="flex flex-col gap-2 sm:flex-row">
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
        <Select value={originType} onValueChange={setOriginType}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("movements.allOrigins")}</SelectItem>
            {Object.entries(ORIGIN_LABEL_KEYS).map(([value, labelKey]) => (
              <SelectItem key={value} value={value}>
                {t(labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("movements.emptyTitle")}
        emptyDescription={t("movements.emptyDescription")}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        minWidthClassName="min-w-[960px]"
      />
    </div>
  );
}
