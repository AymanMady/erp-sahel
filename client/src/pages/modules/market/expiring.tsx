/** Alertes de péremption : lots dont la DLC approche. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatDate, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { marketApi } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { Quantity } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Badge } from "@/shared/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

interface ExpiringRow {
  lot: { id: string; lotNumber: string; expiryDate: string | null; receivedQuantity: string };
  productName: string;
  productSku: string;
}

/** Jours restants avant la DLC — sert à colorer l'urgence. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`).getTime();
  const today = new Date(`${todayInput()}T00:00:00`).getTime();
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

export default function ExpiringPage() {
  const [withinDays, setWithinDays] = useState("30");

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.market.expiring(Number(withinDays)),
    queryFn: () => marketApi.listExpiring(Number(withinDays)),
  });

  const columns: Column<ExpiringRow>[] = [
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
    {
      id: "lot",
      header: "Lot",
      cell: (row) => <span className="tabular">{row.lot.lotNumber}</span>,
    },
    {
      id: "expiry",
      header: "Date limite",
      cell: (row) => formatDate(row.lot.expiryDate),
    },
    {
      id: "remaining",
      header: "Échéance",
      cell: (row) => {
        const days = daysUntil(row.lot.expiryDate);
        if (days === null) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge
            variant="outline"
            className={
              days <= 7 ? "border-status-danger text-status-danger" : "text-status-pending"
            }
          >
            {days <= 0 ? "périmé" : `dans ${days} j`}
          </Badge>
        );
      },
    },
    {
      id: "quantity",
      header: "Quantité",
      align: "end",
      cell: (row) => <Quantity value={row.lot.receivedQuantity} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes de péremption"
        description="Lots dont la date limite de consommation approche."
      >
        <Select value={withinDays} onValueChange={setWithinDays}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Sous 7 jours</SelectItem>
            <SelectItem value="30">Sous 30 jours</SelectItem>
            <SelectItem value="90">Sous 90 jours</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.lot.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune alerte"
        emptyDescription="Aucun lot n'arrive à échéance sur la fenêtre choisie."
      />
    </div>
  );
}
