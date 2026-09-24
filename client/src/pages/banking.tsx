/** Treasury: accounts (bank, cash, mobile money), transactions and reconciliation. */

import { useState } from "react";
import { IconArrowsExchange, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BANK_ACCOUNT_TYPES, BANK_TRANSACTION_TYPES } from "@shared/schema";
import { formatDate, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { bankingApi } from "@/entities/banking/api";
import type { BankAccount, BankTransaction } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money, useMoneyFormatter } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatCard } from "@/shared/components/stat-card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

/** Translation keys (in the `banking` namespace) for each account type. */
const ACCOUNT_TYPE_KEYS: Record<string, string> = {
  BANK: "accountTypes.bank",
  CASH: "accountTypes.cash",
  MOBILE_MONEY: "accountTypes.mobileMoney",
};

/** Translation keys (in the `banking` namespace) for each transaction type. */
const TRANSACTION_TYPE_KEYS: Record<string, string> = {
  DEPOSIT: "transactionTypes.deposit",
  WITHDRAWAL: "transactionTypes.withdrawal",
  TRANSFER: "transactionTypes.transfer",
};

export default function BankingPage() {
  const { t } = useTranslation("banking");
  const queryClient = useQueryClient();
  const { can } = useSession();
  const formatMoneyValue = useMoneyFormatter();
  const [accountId, setAccountId] = useState(ALL);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [accountOpen, setAccountOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: queryKeys.bankAccounts,
    queryFn: () => bankingApi.listAccounts(),
  });
  const { data: totals } = useQuery({
    queryKey: queryKeys.treasury,
    queryFn: () => bankingApi.totals(),
  });
  const filters = { bankAccountId: accountId === ALL ? null : accountId, ...page };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.bankTransactions(filters),
    queryFn: () => bankingApi.listTransactions(filters),
  });

  const reconcile = useMutation({
    mutationFn: ({ id, reconciled }: { id: string; reconciled: boolean }) =>
      bankingApi.setReconciled(id, reconciled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const accountName = new Map((accounts ?? []).map((account) => [account.id, account.name]));

  const columns: Column<BankTransaction>[] = [
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDate(row.date) },
    {
      id: "account",
      header: t("columns.account"),
      hideOnMobile: true,
      cell: (row) => accountName.get(row.bankAccountId) ?? "—",
    },
    {
      id: "description",
      header: t("columns.label"),
      cell: (row) => <span className="font-medium">{row.description}</span>,
    },
    {
      id: "type",
      header: t("common:labels.type"),
      cell: (row) => (
        <Badge variant="outline">
          {TRANSACTION_TYPE_KEYS[row.transactionType]
            ? t(TRANSACTION_TYPE_KEYS[row.transactionType])
            : row.transactionType}
        </Badge>
      ),
    },
    {
      id: "reference",
      header: t("common:labels.reference"),
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.reference || "—"}</span>,
    },
    {
      id: "reconciled",
      header: t("columns.reconciled"),
      align: "center",
      cell: (row) =>
        can("banking.write") ? (
          <Checkbox
            checked={row.reconciled}
            onCheckedChange={(checked) =>
              reconcile.mutate({ id: row.id, reconciled: checked === true })
            }
            aria-label={t("markReconciled")}
          />
        ) : row.reconciled ? (
          t("common:states.yes")
        ) : (
          t("common:states.no")
        ),
    },
    {
      id: "amount",
      header: t("common:labels.amount"),
      align: "end",
      cell: (row) => (
        <Money
          cents={row.transactionType === "WITHDRAWAL" ? -row.amountCents : row.amountCents}
          tone="auto"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")}>
        {can("banking.write") ? (
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <IconArrowsExchange className="size-4" />
              {t("actions.transfer")}
            </Button>
            <Button variant="outline" onClick={() => setMovementOpen(true)}>
              {t("actions.newMovement")}
            </Button>
            <Button onClick={() => setAccountOpen(true)}>
              <IconPlus className="size-4" />
              {t("actions.newAccount")}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("stats.total")} value={formatMoneyValue(totals?.totalCents ?? 0)} />
        <StatCard label={t("stats.cash")} value={formatMoneyValue(totals?.cashCents ?? 0)} />
        <StatCard label={t("stats.bank")} value={formatMoneyValue(totals?.bankCents ?? 0)} />
        <StatCard label={t("stats.mobile")} value={formatMoneyValue(totals?.mobileCents ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("accounts.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(accounts ?? []).map((account) => (
            <div key={account.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="tabular text-xs text-muted-foreground">{account.code}</p>
                </div>
                <Badge variant="outline">
                  {ACCOUNT_TYPE_KEYS[account.accountType]
                    ? t(ACCOUNT_TYPE_KEYS[account.accountType])
                    : account.accountType}
                </Badge>
              </div>
              <p className="mt-2 text-lg font-semibold">
                <Money cents={account.balanceCents} />
              </p>
            </div>
          ))}
          {(accounts?.length ?? 0) === 0 ? (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              {t("accounts.empty")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="sm:w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.allAccounts")}</SelectItem>
            {(accounts ?? []).map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ResourceTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          error={error ? errorMessage(error) : null}
          emptyTitle={t("empty.title")}
          emptyDescription={t("empty.description")}
          pagination={{
            total: data?.total ?? 0,
            limit: page.limit,
            offset: page.offset,
            onChange: setPage,
          }}
          minWidthClassName="min-w-[900px]"
        />
      </div>

      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <MovementDialog
        open={movementOpen}
        onOpenChange={setMovementOpen}
        accounts={accounts ?? []}
      />
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        accounts={accounts ?? []}
      />
    </div>
  );
}

function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("banking");
  const queryClient = useQueryClient();
  const { company } = useSession();
  const [form, setForm] = useState({
    code: "",
    name: "",
    accountType: "BANK" as (typeof BANK_ACCOUNT_TYPES)[number],
    accountNumber: "",
    iban: "",
    currency: company?.currency ?? "MRU",
    isDefault: false,
  });

  const mutation = useMutation({
    mutationFn: () => bankingApi.createAccount(form),
    onSuccess: () => {
      toast.success(t("toasts.accountCreated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.bankAccounts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("accountDialog.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label={t("common:labels.code")} required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                required
                className="tabular"
              />
            </Field>
            <Field label={t("common:labels.type")}>
              <Select
                value={form.accountType}
                onValueChange={(value) =>
                  setForm({ ...form, accountType: value as (typeof BANK_ACCOUNT_TYPES)[number] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BANK_ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(ACCOUNT_TYPE_KEYS[type])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          {form.accountType === "BANK" ? (
            <FieldGrid>
              <Field label={t("accountDialog.accountNumber")}>
                <Input
                  value={form.accountNumber}
                  onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                  className="tabular"
                />
              </Field>
              <Field label={t("accountDialog.iban")}>
                <Input
                  value={form.iban}
                  onChange={(event) => setForm({ ...form, iban: event.target.value })}
                  className="tabular"
                  dir="ltr"
                />
              </Field>
            </FieldGrid>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked === true })}
            />
            {t("accountDialog.isDefault")}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: BankAccount[];
}) {
  const { t } = useTranslation("banking");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    bankAccountId: "",
    date: todayInput(),
    description: "",
    transactionType: "DEPOSIT" as (typeof BANK_TRANSACTION_TYPES)[number],
    amountCents: 0,
    reference: "",
  });

  const mutation = useMutation({
    mutationFn: () => bankingApi.createTransaction(form),
    onSuccess: () => {
      toast.success(t("toasts.movementSaved"));
      void queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bankAccounts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("movementDialog.title")}</DialogTitle>
          <DialogDescription>{t("movementDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldGrid>
            <Field label={t("columns.account")} required>
              <Select
                value={form.bankAccountId}
                onValueChange={(value) => setForm({ ...form, bankAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("common:labels.date")}>
              <Input
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field label={t("movementDialog.direction")}>
              <Select
                value={form.transactionType}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    transactionType: value as (typeof BANK_TRANSACTION_TYPES)[number],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEPOSIT">{t("movementDialog.deposit")}</SelectItem>
                  <SelectItem value="WITHDRAWAL">{t("movementDialog.withdrawal")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("common:labels.amount")} required>
              <MoneyInput
                valueCents={form.amountCents}
                onChange={(cents) => setForm({ ...form, amountCents: cents })}
              />
            </Field>
          </FieldGrid>
          <Field label={t("columns.label")} required>
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label={t("common:labels.reference")}>
            <Input
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              !form.bankAccountId ||
              !form.description.trim() ||
              form.amountCents <= 0
            }
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
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: BankAccount[];
}) {
  const { t } = useTranslation("banking");
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    fromAccountId: "",
    toAccountId: "",
    amountCents: 0,
    date: todayInput(),
    description: t("transferDialog.defaultDescription"),
  }));

  const mutation = useMutation({
    mutationFn: () => bankingApi.transfer(form),
    onSuccess: () => {
      toast.success(t("toasts.transferDone"));
      void queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bankAccounts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("transferDialog.title")}</DialogTitle>
          <DialogDescription>{t("transferDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldGrid>
            <Field label={t("transferDialog.from")} required>
              <Select
                value={form.fromAccountId}
                onValueChange={(value) => setForm({ ...form, fromAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("transferDialog.to")} required>
              <Select
                value={form.toAccountId}
                onValueChange={(value) => setForm({ ...form, toAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("common:actions.select")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((account) => account.id !== form.fromAccountId)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("common:labels.amount")} required>
              <MoneyInput
                valueCents={form.amountCents}
                onChange={(cents) => setForm({ ...form, amountCents: cents })}
              />
            </Field>
            <Field label={t("common:labels.date")}>
              <Input
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label={t("columns.label")}>
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              !form.fromAccountId ||
              !form.toAccountId ||
              form.amountCents <= 0
            }
          >
            {t("transferDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
