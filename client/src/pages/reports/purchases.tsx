/** Rapport des achats sur une période. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { addDays, formatDate, todayInput } from "@shared/format";
import { reportsApi } from "@/entities/reports/api";
import { queryKeys } from "@/shared/api/query-client";
import { useMoneyFormatter } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { StatCard } from "@/shared/components/stat-card";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

export default function PurchasesReportPage() {
  const formatMoneyValue = useMoneyFormatter();
  const [fromDate, setFromDate] = useState(addDays(todayInput(), -29));
  const [toDate, setToDate] = useState(todayInput());

  const filters = { fromDate, toDate };
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports("purchases", filters),
    queryFn: () => reportsApi.purchases(filters),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapport des achats"
        description="Volume d'approvisionnement sur la période."
      >
        <Input
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
          className="w-[150px]"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
          className="w-[150px]"
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Commandes passées"
          value={data?.summary.orderCount ?? 0}
          loading={isLoading}
        />
        <StatCard
          label="Montant HT"
          value={formatMoneyValue(data?.summary.totalHtCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label="Montant TTC"
          value={formatMoneyValue(data?.summary.totalTtcCents ?? 0)}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Période analysée : du {formatDate(fromDate)} au {formatDate(toDate)}. Les montants
          incluent toutes les commandes fournisseurs, y compris celles non encore réceptionnées.
        </CardContent>
      </Card>
    </div>
  );
}
