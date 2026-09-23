/** Journal des mouvements de stock — la source de vérité auditable des soldes. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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

const ORIGIN_LABELS: Record<string, string> = {
  purchase_receipt: "Réception achat",
  sales_invoice: "Facture de vente",
  credit_note: "Avoir",
  pos_ticket: "Ticket de caisse",
  manual: "Saisie manuelle",
  inventory_count: "Inventaire",
  transfer: "Transfert",
};

export default function MovementsPage() {
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
    { id: "date", header: "Date", cell: (row) => formatDateTime(row.createdAt) },
    {
      id: "product",
      header: "Article",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          <p className="tabular text-xs text-muted-foreground">{row.productSku}</p>
        </div>
      ),
    },
    { id: "warehouse", header: "Magasin", hideOnMobile: true, cell: (row) => row.warehouseName },
    {
      id: "type",
      header: "Type",
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
      header: "Origine",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          <p>{ORIGIN_LABELS[row.originType] ?? row.originType}</p>
          {row.reference ? (
            <p className="tabular text-xs text-muted-foreground">{row.reference}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "quantity",
      header: "Quantité",
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
      header: "Solde après",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Quantity value={row.balanceAfter} />,
    },
    {
      id: "cost",
      header: "Coût unitaire",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Money cents={row.unitCostCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mouvements de stock"
        description="Chaque entrée, sortie ou ajustement est tracé avec son origine."
      />

      <div className="flex flex-col gap-2 sm:flex-row">
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
        <Select value={originType} onValueChange={setOriginType}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toutes les origines</SelectItem>
            {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
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
        emptyTitle="Aucun mouvement"
        emptyDescription="Les mouvements apparaissent dès la première réception ou vente."
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
