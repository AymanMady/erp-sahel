/** Trial balance: totals and balances per account ([FR-CPT-3]). */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { errorMessage } from "@/shared/api/api-error";
import { accountingApi } from "@/entities/accounting/api";
import type { BalanceRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Input } from "@/shared/ui/input";
import { TableCell, TableRow } from "@/shared/ui/table";

export default function BalancePage() {
  const { t } = useTranslation("accounting");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters = { fromDate: fromDate || null, toDate: toDate || null };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.balance(filters),
    queryFn: () => accountingApi.balance(filters),
  });

  // A trial balance is only useful if it does not bury what matters: accounts with
  // no movement in the period are hidden.
  const rows = (data?.items ?? []).filter((row) => row.debitCents !== 0 || row.creditCents !== 0);

  const columns: Column<BalanceRow>[] = [
    {
      id: "code",
      header: t("columns.account"),
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    { id: "name", header: t("columns.accountName"), cell: (row) => row.name },
    {
      id: "type",
      header: t("columns.nature"),
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {t(`accountTypes.${row.accountType}`, { defaultValue: row.accountType })}
        </span>
      ),
    },
    {
      id: "debit",
      header: t("columns.debit"),
      align: "end",
      cell: (row) => <Money cents={row.debitCents} withSymbol={false} />,
    },
    {
      id: "credit",
      header: t("columns.credit"),
      align: "end",
      cell: (row) => <Money cents={row.creditCents} withSymbol={false} />,
    },
    {
      id: "balance",
      header: t("columns.balance"),
      align: "end",
      cell: (row) => <Money cents={row.balanceCents} tone="auto" withSymbol={false} />,
    },
  ];

  const balanced = (data?.totals.debitCents ?? 0) === (data?.totals.creditCents ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("balance.title")} description={t("balance.description")} />

      <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
        <Input
          type="date"
          aria-label={t("filters.fromDate")}
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          type="date"
          aria-label={t("filters.toDate")}
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
      </div>

      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.accountId}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("balance.emptyTitle")}
        emptyDescription={t("balance.emptyDescription")}
        footer={
          rows.length > 0 ? (
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={3}>{t("balance.totals")}</TableCell>
              <TableCell className="text-end">
                <Money cents={data?.totals.debitCents ?? 0} withSymbol={false} />
              </TableCell>
              <TableCell className="text-end">
                <Money cents={data?.totals.creditCents ?? 0} withSymbol={false} />
              </TableCell>
              <TableCell className="text-end">
                <span className={balanced ? "text-status-success" : "text-status-danger"}>
                  {balanced ? t("balanced") : t("unbalanced")}
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
