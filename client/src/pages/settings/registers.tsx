/** Cash registers (points of sale) and past sessions. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settings");
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
      toast.success(t("registers.archived"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.posRegisters });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const registerColumns: Column<PosRegister>[] = [
    {
      id: "code",
      header: t("common:labels.code"),
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: t("common:labels.name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("settings.write") ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("common:actions.archive")}
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
      header: t("registers.columns.register"),
      cell: (row) => <span className="font-medium">{row.registerName}</span>,
    },
    { id: "user", header: t("registers.columns.cashier"), cell: (row) => row.userName },
    {
      id: "opened",
      header: t("registers.columns.openedAt"),
      cell: (row) => formatDateTime(row.openedAt),
    },
    {
      id: "closed",
      header: t("registers.columns.closedAt"),
      hideOnMobile: true,
      cell: (row) => (row.closedAt ? formatDateTime(row.closedAt) : "—"),
    },
    {
      id: "status",
      header: t("common:labels.status"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "sales",
      header: t("registers.columns.sales"),
      align: "end",
      cell: (row) => <Money cents={row.totalSalesCents} />,
    },
    {
      id: "difference",
      header: t("registers.columns.difference"),
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
      <PageHeader title={t("registers.title")} description={t("registers.description")}>
        {can("settings.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            {t("registers.new")}
          </Button>
        ) : null}
      </PageHeader>

      <Tabs defaultValue="registers">
        <TabsList>
          <TabsTrigger value="registers">{t("registers.tabs.registers")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("registers.tabs.sessions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="registers">
          <ResourceTable
            columns={registerColumns}
            rows={registers ?? []}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={error ? errorMessage(error) : null}
            emptyTitle={t("registers.emptyRegistersTitle")}
            emptyDescription={t("registers.emptyRegistersDescription")}
          />
        </TabsContent>

        <TabsContent value="sessions">
          <ResourceTable
            columns={sessionColumns}
            rows={(sessions ?? []) as unknown as SessionRow[]}
            rowKey={(row) => row.id}
            emptyTitle={t("registers.emptySessionsTitle")}
            emptyDescription={t("registers.emptySessionsDescription")}
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
  const { t } = useTranslation("settings");
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
      toast.success(t("registers.created"));
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
          <DialogTitle>{t("registers.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("common:labels.code")} required>
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              required
              className="tabular"
            />
          </Field>
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field
            label={t("registers.dialog.warehouse")}
            required
            hint={t("registers.dialog.warehouseHint")}
          >
            <Select
              value={form.warehouseId}
              onValueChange={(value) => setForm({ ...form, warehouseId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("common:actions.select")} />
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
          <Field
            label={t("registers.dialog.cashAccount")}
            hint={t("registers.dialog.cashAccountHint")}
          >
            <Select
              value={form.cashAccountId}
              onValueChange={(value) => setForm({ ...form, cashAccountId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("registers.dialog.defaultAccount")}</SelectItem>
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
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || !form.code.trim() || !form.name.trim() || !form.warehouseId
              }
            >
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
