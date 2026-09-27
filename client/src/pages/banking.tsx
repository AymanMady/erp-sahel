/**
 * Cash and bank: one card per place where money is kept (register, bank, Bankily, Masrvi,
 * Sedad), then the history of money in and out. Tapping a card shows only its history.
 */

import { useEffect, useState } from "react";
import {
  IconArrowsExchange,
  IconBuildingBank,
  IconCash,
  IconDeviceMobile,
  IconPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BANK_TRANSACTION_TYPES, type BankAccountType } from "@shared/schema";
import { formatDate, slugify, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { bankingApi } from "@/entities/banking/api";
import type { BankAccount, BankTransaction } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
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

/** Translation keys (in the `banking` namespace) for each account type. */
const ACCOUNT_TYPE_KEYS: Record<BankAccountType, string> = {
  CASH: "accountTypes.cash",
  MOBILE_MONEY: "accountTypes.mobileMoney",
  BANK: "accountTypes.bank",
};

const ACCOUNT_ICONS: Record<BankAccountType, typeof IconCash> = {
  CASH: IconCash,
  MOBILE_MONEY: IconDeviceMobile,
  BANK: IconBuildingBank,
};

/** Register first, then phone payments, then banks — the order a shop thinks in. */
const TYPE_ORDER: BankAccountType[] = ["CASH", "MOBILE_MONEY", "BANK"];

/** The code the server needs, made from the name so nobody has to invent one. */
function codeFromName(name: string, taken: Set<string>): string {
  const base = slugify(name).toUpperCase().slice(0, 20) || "COMPTE";
  let code = base;
  for (let index = 2; taken.has(code); index += 1) code = `${base}-${index}`;
  return code;
}

export default function BankingPage() {
  const { t } = useTranslation("banking");
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [accountOpen, setAccountOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const { data: accountList } = useQuery({
    queryKey: queryKeys.bankAccounts,
    queryFn: () => bankingApi.listAccounts(),
  });
  const accounts = [...(accountList ?? [])].sort(
    (a, b) => TYPE_ORDER.indexOf(a.accountType) - TYPE_ORDER.indexOf(b.accountType)
  );
  const totalCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0);
  const filters = { bankAccountId: accountId, ...page };
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

  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;

  const selectAccount = (id: string | null) => {
    setAccountId(id);
    setPage((current) => ({ ...current, offset: 0 }));
  };

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
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.description}</p>
          {row.reference ? (
            <p className="tabular text-xs text-muted-foreground" dir="ltr">
              {row.reference}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "amount",
      header: t("columns.amount"),
      align: "end",
      cell: (row) => (
        <Money
          cents={row.transactionType === "WITHDRAWAL" ? -row.amountCents : row.amountCents}
          tone="auto"
        />
      ),
    },
    {
      id: "reconciled",
      header: t("columns.reconciled"),
      align: "center",
      hideOnMobile: true,
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => selectAccount(null)}
          aria-pressed={accountId === null}
          className={cn(
            "rounded-lg border p-4 text-start transition-colors hover:bg-muted sm:col-span-2 lg:col-span-3",
            accountId === null && "border-primary ring-1 ring-primary"
          )}
        >
          <p className="text-sm text-muted-foreground">{t("stats.total")}</p>
          <p className="mt-1 text-2xl font-semibold">
            <Money cents={totalCents} />
          </p>
        </button>
        {accounts.map((account) => {
          const Icon = ACCOUNT_ICONS[account.accountType];
          const selected = account.id === accountId;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => selectAccount(selected ? null : account.id)}
              aria-pressed={selected}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-4 text-start transition-colors hover:bg-muted",
                selected && "border-primary ring-1 ring-primary"
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{account.name}</span>
                <span className="block text-lg font-semibold">
                  <Money cents={account.balanceCents} />
                </span>
              </span>
            </button>
          );
        })}
        {accounts.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            {t("accounts.empty")}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {selectedAccount
              ? t("history.ofAccount", { name: selectedAccount.name })
              : t("history.all")}
          </h2>
          {selectedAccount ? (
            <Button variant="ghost" size="sm" onClick={() => selectAccount(null)}>
              {t("history.showAll")}
            </Button>
          ) : null}
        </div>

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
          minWidthClassName="md:min-w-[640px]"
        />
      </div>

      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} accounts={accounts} />
      <MovementDialog
        open={movementOpen}
        onOpenChange={setMovementOpen}
        accounts={accounts}
        defaultAccountId={accountId}
      />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={accounts} />
    </div>
  );
}

function AccountDialog({
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
  const emptyForm = {
    name: "",
    accountType: "MOBILE_MONEY" as BankAccountType,
    accountNumber: "",
    isDefault: false,
  };
  const [form, setForm] = useState(emptyForm);

  const mutation = useMutation({
    mutationFn: () =>
      bankingApi.createAccount({
        ...form,
        name: form.name.trim(),
        code: codeFromName(form.name, new Set(accounts.map((account) => account.code))),
      }),
    onSuccess: () => {
      toast.success(t("toasts.accountCreated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.bankAccounts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
      setForm(emptyForm);
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
          <Field label={t("accountDialog.kind")}>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_ORDER.map((type) => {
                const Icon = ACCOUNT_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={form.accountType === type}
                    onClick={() => setForm({ ...form, accountType: type })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border p-3 text-center text-xs font-medium transition-colors",
                      form.accountType === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                  >
                    <Icon className="size-5" />
                    {t(ACCOUNT_TYPE_KEYS[type])}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={t(`accountDialog.namePlaceholder.${form.accountType}`)}
              required
            />
          </Field>
          {form.accountType === "BANK" ? (
            <Field label={t("accountDialog.accountNumber")}>
              <Input
                value={form.accountNumber}
                onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                className="tabular"
                dir="ltr"
              />
            </Field>
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
            <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
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
  defaultAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: BankAccount[];
  defaultAccountId: string | null;
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

  useEffect(() => {
    if (open) setForm((current) => ({ ...current, bankAccountId: defaultAccountId ?? "" }));
  }, [open, defaultAccountId]);

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
