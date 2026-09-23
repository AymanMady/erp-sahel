/** Balance générale : cumuls et soldes par compte ([FR-CPT-3]). */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/api/api-error";
import { accountingApi } from "@/entities/accounting/api";
import type { BalanceRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Input } from "@/shared/ui/input";
import { TableCell, TableRow } from "@/shared/ui/table";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Actif",
  LIABILITY: "Passif",
  EQUITY: "Capitaux propres",
  REVENUE: "Produits",
  EXPENSE: "Charges",
};

export default function BalancePage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters = { fromDate: fromDate || null, toDate: toDate || null };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.balance(filters),
    queryFn: () => accountingApi.balance(filters),
  });

  // Une balance est utile si elle ne noie pas l'essentiel : on masque les comptes
  // n'ayant aucun mouvement sur la période.
  const rows = (data?.items ?? []).filter((row) => row.debitCents !== 0 || row.creditCents !== 0);

  const columns: Column<BalanceRow>[] = [
    {
      id: "code",
      header: "Compte",
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    { id: "name", header: "Intitulé", cell: (row) => row.name },
    {
      id: "type",
      header: "Nature",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {ACCOUNT_TYPE_LABELS[row.accountType] ?? row.accountType}
        </span>
      ),
    },
    {
      id: "debit",
      header: "Débit",
      align: "end",
      cell: (row) => <Money cents={row.debitCents} withSymbol={false} />,
    },
    {
      id: "credit",
      header: "Crédit",
      align: "end",
      cell: (row) => <Money cents={row.creditCents} withSymbol={false} />,
    },
    {
      id: "balance",
      header: "Solde",
      align: "end",
      cell: (row) => <Money cents={row.balanceCents} tone="auto" withSymbol={false} />,
    },
  ];

  const balanced = (data?.totals.debitCents ?? 0) === (data?.totals.creditCents ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance"
        description="Cumuls débit/crédit par compte. Le total des deux colonnes doit être égal."
      />

      <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
        <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
      </div>

      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.accountId}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Balance vide"
        emptyDescription="Aucun compte mouvementé sur la période sélectionnée."
        footer={
          rows.length > 0 ? (
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={3}>Totaux</TableCell>
              <TableCell className="text-end">
                <Money cents={data?.totals.debitCents ?? 0} withSymbol={false} />
              </TableCell>
              <TableCell className="text-end">
                <Money cents={data?.totals.creditCents ?? 0} withSymbol={false} />
              </TableCell>
              <TableCell className="text-end">
                <span className={balanced ? "text-status-success" : "text-status-danger"}>
                  {balanced ? "Équilibrée" : "Déséquilibrée"}
                </span>
              </TableCell>
            </TableRow>
          ) : null
        }
        minWidthClassName="min-w-[820px]"
      />
    </div>
  );
}
