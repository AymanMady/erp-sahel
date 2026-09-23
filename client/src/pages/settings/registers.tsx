/** Caisses (points de vente) et sessions passées. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { formatDateTime } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { bankingApi } from "@/entities/banking/api";
import { inventoryApi } from "@/entities/inventory/api";
import { posApi } from "@/entities/pos/api";
import type { PosRegister } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

const NONE = "NONE";

interface SessionRow {
  id: string;
  registerName: string;
  userName: string;
  openedAt: string | Date;
  closedAt: string | Date | null;
  status: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  expectedBalanceCents: number;
  totalSalesCents: number;
}

export default function RegistersSettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);

  const {
    data: registers,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.posRegisters,
    queryFn: () => posApi.listRegisters(),
  });
  const { data: sessions } = useQuery({
    queryKey: queryKeys.posSessions(),
    queryFn: () => posApi.listSessions(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => posApi.archiveRegister(id),
    onSuccess: () => {
      toast.success("Caisse archivée.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.posRegisters });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const registerColumns: Column<PosRegister>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    { id: "name", header: "Nom", cell: (row) => <span className="font-medium">{row.name}</span> },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("settings.write") ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Archiver"
            onClick={() => archive.mutate(row.id)}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  const sessionColumns: Column<SessionRow>[] = [
    {
      id: "register",
      header: "Caisse",
      cell: (row) => <span className="font-medium">{row.registerName}</span>,
    },
    { id: "user", header: "Caissier", cell: (row) => row.userName },
    { id: "opened", header: "Ouverture", cell: (row) => formatDateTime(row.openedAt) },
    {
      id: "closed",
      header: "Clôture",
      hideOnMobile: true,
      cell: (row) => (row.closedAt ? formatDateTime(row.closedAt) : "—"),
    },
    { id: "status", header: "Statut", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "sales",
      header: "Ventes",
      align: "end",
      cell: (row) => <Money cents={row.totalSalesCents} />,
    },
    {
      id: "difference",
      header: "Écart",
      align: "end",
      cell: (row) =>
        row.status === "CLOSED" ? (
          <Money cents={row.closingBalanceCents - row.expectedBalanceCents} tone="auto" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Caisses" description="Postes de vente et historique des sessions.">
        {can("settings.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouvelle caisse
          </Button>
        ) : null}
      </PageHeader>

      <Tabs defaultValue="registers">
        <TabsList>
          <TabsTrigger value="registers">Caisses</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="registers">
          <ResourceTable
            columns={registerColumns}
            rows={registers ?? []}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={error ? errorMessage(error) : null}
            emptyTitle="Aucune caisse"
            emptyDescription="Une caisse est nécessaire pour ouvrir une session de vente."
          />
        </TabsContent>

        <TabsContent value="sessions">
          <ResourceTable
            columns={sessionColumns}
            rows={(sessions ?? []) as unknown as SessionRow[]}
            rowKey={(row) => row.id}
            emptyTitle="Aucune session"
            emptyDescription="Les sessions apparaissent dès la première ouverture de caisse."
            minWidthClassName="min-w-[900px]"
          />
        </TabsContent>
      </Tabs>

      <RegisterDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function RegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: "", name: "", warehouseId: "", cashAccountId: NONE });

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
    enabled: open,
  });
  const { data: accounts } = useQuery({
    queryKey: queryKeys.bankAccounts,
    queryFn: () => bankingApi.listAccounts(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      posApi.createRegister({
        ...form,
        cashAccountId: form.cashAccountId === NONE ? null : form.cashAccountId,
      }),
    onSuccess: () => {
      toast.success("Caisse créée.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.posRegisters });
      onOpenChange(false);
      setForm({ code: "", name: "", warehouseId: "", cashAccountId: NONE });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle caisse</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Code" required>
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              required
              className="tabular"
            />
          </Field>
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Magasin rattaché" required hint="Détermine d'où sort le stock vendu.">
            <Select
              value={form.warehouseId}
              onValueChange={(value) => setForm({ ...form, warehouseId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses ?? []).map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Compte de caisse" hint="Crédité par les encaissements en espèces.">
            <Select
              value={form.cashAccountId}
              onValueChange={(value) => setForm({ ...form, cashAccountId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Compte par défaut</SelectItem>
                {(accounts ?? [])
                  .filter((account) => account.accountType === "CASH")
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || !form.code.trim() || !form.name.trim() || !form.warehouseId
              }
            >
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
