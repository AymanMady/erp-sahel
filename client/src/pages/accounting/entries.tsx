/** Journal comptable : écritures et saisie manuelle ([FR-CPT-1]). */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { JOURNAL_TYPES } from "@shared/schema";
import { formatDate, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { accountingApi } from "@/entities/accounting/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
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
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

const ALL = "ALL";

const JOURNAL_TYPE_LABELS: Record<string, string> = {
  SALES: "Ventes",
  PURCHASES: "Achats",
  BANK: "Banque",
  CASH: "Caisse",
  MISC: "Opérations diverses",
};

export default function EntriesPage() {
  const { can } = useSession();
  const [journalId, setJournalId] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [open, setOpen] = useState(false);

  const { data: journals } = useQuery({
    queryKey: queryKeys.journals,
    queryFn: () => accountingApi.listJournals(),
  });

  const filters = {
    journalId: journalId === ALL ? null : journalId,
    fromDate: fromDate || null,
    toDate: toDate || null,
    limit: 50,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.entries(filters),
    queryFn: () => accountingApi.listEntries(filters),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal comptable"
        description="Toutes les écritures, générées automatiquement ou saisies à la main."
      >
        {can("accounting.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Saisir une écriture
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={journalId} onValueChange={setJournalId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les journaux</SelectItem>
            {(journals ?? []).map((journal) => (
              <SelectItem key={journal.id} value={journal.id}>
                {journal.code} — {journal.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-status-danger">
            {errorMessage(error)}
          </CardContent>
        </Card>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aucune écriture sur la période. Les factures et règlements en génèrent automatiquement.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data?.items.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="tabular text-sm font-semibold">{entry.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(entry.date)} · {entry.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{entry.journalCode}</Badge>
                    <Money cents={entry.totalDebitCents} className="text-sm font-medium" />
                  </div>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table className="min-w-[560px]">
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Compte</TableHead>
                        <TableHead>Libellé</TableHead>
                        <TableHead className="text-end">Débit</TableHead>
                        <TableHead className="text-end">Crédit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entry.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <span className="tabular font-medium">{line.accountCode}</span>
                            <span className="ms-2 text-muted-foreground">{line.accountName}</span>
                          </TableCell>
                          <TableCell className="text-sm">{line.label}</TableCell>
                          <TableCell className="text-end">
                            {line.debitCents ? (
                              <Money cents={line.debitCents} withSymbol={false} />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {line.creditCents ? (
                              <Money cents={line.creditCents} withSymbol={false} />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ManualEntryDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ManualEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [journalType, setJournalType] = useState<(typeof JOURNAL_TYPES)[number]>("MISC");
  const [date, setDate] = useState(todayInput());
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState([
    { key: "a", accountId: "", debitCents: 0, creditCents: 0, label: "" },
    { key: "b", accountId: "", debitCents: 0, creditCents: 0, label: "" },
  ]);

  const { data: accounts } = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => accountingApi.listAccounts(),
    enabled: open,
  });

  const totalDebit = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.creditCents, 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const mutation = useMutation({
    mutationFn: () =>
      accountingApi.createEntry({
        journalType,
        date,
        label,
        reference,
        lines: lines
          .filter((line) => line.accountId && (line.debitCents > 0 || line.creditCents > 0))
          .map((line) => ({
            accountId: line.accountId,
            debitCents: line.debitCents,
            creditCents: line.creditCents,
            label: line.label,
          })),
      }),
    onSuccess: () => {
      toast.success("Écriture enregistrée.");
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = (key: string, patch: Partial<(typeof lines)[number]>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Saisie d'une écriture</DialogTitle>
          <DialogDescription>
            L'écriture doit être équilibrée : le total des débits doit égaler celui des crédits.
          </DialogDescription>
        </DialogHeader>

        <FieldGrid columns={3}>
          <Field label="Journal">
            <Select
              value={journalType}
              onValueChange={(value) => setJournalType(value as (typeof JOURNAL_TYPES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOURNAL_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {JOURNAL_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Référence">
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
        </FieldGrid>

        <Field label="Libellé de l'écriture" required>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} required />
        </Field>

        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Compte</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="w-32 text-end">Débit</TableHead>
                <TableHead className="w-32 text-end">Crédit</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.key}>
                  <TableCell>
                    <Select
                      value={line.accountId}
                      onValueChange={(value) => update(line.key, { accountId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Compte" />
                      </SelectTrigger>
                      <SelectContent>
                        {(accounts ?? [])
                          .filter((account) => !account.isGroup)
                          .map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.code} — {account.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.label}
                      onChange={(event) => update(line.key, { label: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      valueCents={line.debitCents}
                      onChange={(cents) => update(line.key, { debitCents: cents, creditCents: 0 })}
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      valueCents={line.creditCents}
                      onChange={(cents) => update(line.key, { creditCents: cents, debitCents: 0 })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Supprimer"
                      disabled={lines.length <= 2}
                      onClick={() =>
                        setLines((current) => current.filter((entry) => entry.key !== line.key))
                      }
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: Math.random().toString(36).slice(2),
                  accountId: "",
                  debitCents: 0,
                  creditCents: 0,
                  label: "",
                },
              ])
            }
          >
            <IconPlus className="size-4" />
            Ajouter une ligne
          </Button>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              Débit <Money cents={totalDebit} className="font-medium text-foreground" />
            </span>
            <span className="text-muted-foreground">
              Crédit <Money cents={totalCredit} className="font-medium text-foreground" />
            </span>
            <Badge
              variant="outline"
              className={balanced ? "text-status-success" : "text-status-danger"}
            >
              {balanced ? "Équilibrée" : "Déséquilibrée"}
            </Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!balanced || !label.trim() || mutation.isPending}
          >
            Enregistrer l'écriture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
