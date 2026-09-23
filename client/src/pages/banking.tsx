/** Trésorerie : comptes (banque, caisse, mobile money), mouvements et rapprochement. */

import { useState } from "react";
import { IconArrowsExchange, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  BANK: "Compte bancaire",
  CASH: "Caisse",
  MOBILE_MONEY: "Mobile money",
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "Dépôt",
  WITHDRAWAL: "Retrait",
  TRANSFER: "Virement",
};

export default function BankingPage() {
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
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "account",
      header: "Compte",
      hideOnMobile: true,
      cell: (row) => accountName.get(row.bankAccountId) ?? "—",
    },
    {
      id: "description",
      header: "Libellé",
      cell: (row) => <span className="font-medium">{row.description}</span>,
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => (
        <Badge variant="outline">{TRANSACTION_TYPE_LABELS[row.transactionType]}</Badge>
      ),
    },
    {
      id: "reference",
      header: "Référence",
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.reference || "—"}</span>,
    },
    {
      id: "reconciled",
      header: "Rapproché",
      align: "center",
      cell: (row) =>
        can("banking.write") ? (
          <Checkbox
            checked={row.reconciled}
            onCheckedChange={(checked) =>
              reconcile.mutate({ id: row.id, reconciled: checked === true })
            }
            aria-label="Marquer comme rapproché"
          />
        ) : row.reconciled ? (
          "Oui"
        ) : (
          "Non"
        ),
    },
    {
      id: "amount",
      header: "Montant",
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
      <PageHeader title="Trésorerie" description="Comptes, mouvements et rapprochement bancaire.">
        {can("banking.write") ? (
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <IconArrowsExchange className="size-4" />
              Virement interne
            </Button>
            <Button variant="outline" onClick={() => setMovementOpen(true)}>
              Saisir un mouvement
            </Button>
            <Button onClick={() => setAccountOpen(true)}>
              <IconPlus className="size-4" />
              Nouveau compte
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Trésorerie totale" value={formatMoneyValue(totals?.totalCents ?? 0)} />
        <StatCard label="Caisse" value={formatMoneyValue(totals?.cashCents ?? 0)} />
        <StatCard label="Banque" value={formatMoneyValue(totals?.bankCents ?? 0)} />
        <StatCard label="Mobile money" value={formatMoneyValue(totals?.mobileCents ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(accounts ?? []).map((account) => (
            <div key={account.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="tabular text-xs text-muted-foreground">{account.code}</p>
                </div>
                <Badge variant="outline">{ACCOUNT_TYPE_LABELS[account.accountType]}</Badge>
              </div>
              <p className="mt-2 text-lg font-semibold">
                <Money cents={account.balanceCents} />
              </p>
            </div>
          ))}
          {(accounts?.length ?? 0) === 0 ? (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              Aucun compte de trésorerie. Créez-en un pour enregistrer des règlements.
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
            <SelectItem value={ALL}>Tous les comptes</SelectItem>
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
          emptyTitle="Aucun mouvement"
          emptyDescription="Les règlements alimentent automatiquement ce journal."
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
      toast.success("Compte créé.");
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
          <DialogTitle>Nouveau compte de trésorerie</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Code" required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                required
                className="tabular"
              />
            </Field>
            <Field label="Type">
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
                      {ACCOUNT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          {form.accountType === "BANK" ? (
            <FieldGrid>
              <Field label="Numéro de compte">
                <Input
                  value={form.accountNumber}
                  onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                  className="tabular"
                />
              </Field>
              <Field label="IBAN">
                <Input
                  value={form.iban}
                  onChange={(event) => setForm({ ...form, iban: event.target.value })}
                  className="tabular"
                />
              </Field>
            </FieldGrid>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked === true })}
            />
            Compte par défaut pour ce type de règlement
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Créer
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
      toast.success("Mouvement enregistré.");
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
          <DialogTitle>Mouvement de trésorerie</DialogTitle>
          <DialogDescription>
            Pour un dépôt ou un retrait sans facture associée (apport, frais bancaires…).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldGrid>
            <Field label="Compte" required>
              <Select
                value={form.bankAccountId}
                onValueChange={(value) => setForm({ ...form, bankAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
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
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field label="Sens">
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
                  <SelectItem value="DEPOSIT">Dépôt (+)</SelectItem>
                  <SelectItem value="WITHDRAWAL">Retrait (−)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Montant" required>
              <MoneyInput
                valueCents={form.amountCents}
                onChange={(cents) => setForm({ ...form, amountCents: cents })}
              />
            </Field>
          </FieldGrid>
          <Field label="Libellé" required>
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="Référence">
            <Input
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
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
            Enregistrer
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fromAccountId: "",
    toAccountId: "",
    amountCents: 0,
    date: todayInput(),
    description: "Virement interne",
  });

  const mutation = useMutation({
    mutationFn: () => bankingApi.transfer(form),
    onSuccess: () => {
      toast.success("Virement effectué.");
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
          <DialogTitle>Virement interne</DialogTitle>
          <DialogDescription>
            Transfert entre deux comptes de la société (remise d'espèces en banque, par exemple).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldGrid>
            <Field label="Depuis" required>
              <Select
                value={form.fromAccountId}
                onValueChange={(value) => setForm({ ...form, fromAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
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
            <Field label="Vers" required>
              <Select
                value={form.toAccountId}
                onValueChange={(value) => setForm({ ...form, toAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
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
            <Field label="Montant" required>
              <MoneyInput
                valueCents={form.amountCents}
                onChange={(cents) => setForm({ ...form, amountCents: cents })}
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label="Libellé">
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
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
            Virer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
