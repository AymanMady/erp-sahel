/** Grand livre : écritures d'un compte sur une période, avec solde progressif. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { accountingApi } from "@/entities/accounting/api";
import type { LedgerRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

export default function LedgerPage() {
  const [accountId, setAccountId] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState({ limit: 50, offset: 0 });

  const { data: accounts } = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });

  const filters = {
    accountId: accountId === ALL ? null : accountId,
    fromDate: fromDate || null,
    toDate: toDate || null,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.ledger(filters),
    queryFn: () => accountingApi.ledger(filters),
  });

  /**
   * Solde progressif : calculé côté client sur la page affichée. Il n'a de sens que
   * lorsqu'un compte unique est sélectionné — sinon on mélangerait des comptes.
   */
  const rowsWithBalance = useMemo(() => {
    const items = data?.items ?? [];
    if (accountId === ALL) return items.map((row) => ({ ...row, balanceCents: null }));
    let running = 0;
    return items.map((row) => {
      running += row.debitCents - row.creditCents;
      return { ...row, balanceCents: running };
    });
  }, [data, accountId]);

  const columns: Column<LedgerRow & { balanceCents: number | null }>[] = [
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "entry",
      header: "Écriture",
      cell: (row) => <span className="tabular text-sm">{row.entryNumber}</span>,
    },
    {
      id: "account",
      header: "Compte",
      hideOnMobile: true,
      cell: (row) => (
        <span>
          <span className="tabular font-medium">{row.accountCode}</span>
          <span className="ms-2 text-muted-foreground">{row.accountName}</span>
        </span>
      ),
    },
    {
      id: "label",
      header: "Libellé",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.label}</p>
          {row.partyName ? <p className="text-xs text-muted-foreground">{row.partyName}</p> : null}
        </div>
      ),
    },
    {
      id: "debit",
      header: "Débit",
      align: "end",
      cell: (row) => (row.debitCents ? <Money cents={row.debitCents} withSymbol={false} /> : "—"),
    },
    {
      id: "credit",
      header: "Crédit",
      align: "end",
      cell: (row) => (row.creditCents ? <Money cents={row.creditCents} withSymbol={false} /> : "—"),
    },
    {
      id: "balance",
      header: "Solde",
      align: "end",
      cell: (row) =>
        row.balanceCents === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money cents={row.balanceCents} tone="auto" withSymbol={false} />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grand livre"
        description="Détail des mouvements par compte. Sélectionnez un compte pour suivre son solde."
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          value={accountId}
          onValueChange={(value) => {
            setAccountId(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les comptes</SelectItem>
            {(accounts ?? [])
              .filter((account) => !account.isGroup)
              .map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
      </div>

      <ResourceTable
        columns={columns}
        rows={rowsWithBalance}
        rowKey={(row) => row.lineId}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun mouvement"
        emptyDescription="Aucune écriture ne correspond aux critères choisis."
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        minWidthClassName="min-w-[980px]"
      />
    </div>
  );
}
