/**
 * Chart of accounts and accounts used by automatic entries.
 *
 * The second block is what makes the chart of accounts interchangeable ([BR-21]):
 * automatic entries refer to **logical keys**, and this screen says which account
 * serves each key.
 */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ACCOUNT_MAPPING_KEYS, ACCOUNT_TYPES, type AccountMappingKey } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { accountingApi } from "@/entities/accounting/api";
import type { Account } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

export default function ChartOfAccountsPage() {
  const { t } = useTranslation("accounting");
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);

  const {
    data: accounts,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });
  const { data: mappings } = useQuery({
    queryKey: queryKeys.accountMappings,
    queryFn: () => accountingApi.listMappings(),
  });

  const setMapping = useMutation({
    mutationFn: ({ key, accountId }: { key: AccountMappingKey; accountId: string }) =>
      accountingApi.setMapping(key, accountId),
    onSuccess: () => {
      toast.success(t("accounts.mappingUpdated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.accountMappings });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const mappingByKey = new Map((mappings ?? []).map((entry) => [entry.key, entry.accountId]));

  const columns: Column<Account>[] = [
    {
      id: "code",
      header: t("columns.accountNumber"),
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    { id: "name", header: t("columns.accountName"), cell: (row) => row.name },
    {
      id: "type",
      header: t("columns.nature"),
      cell: (row) => (
        <Badge variant="outline">
          {t(`accountTypes.${row.accountType}`, { defaultValue: row.accountType })}
        </Badge>
      ),
    },
    {
      id: "group",
      header: t("columns.group"),
      align: "center",
      hideOnMobile: true,
      cell: (row) => (row.isGroup ? t("common:states.yes") : "—"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("accounts.title")} description={t("accounts.description")}>
        {can("accounting.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            {t("accounts.newAccount")}
          </Button>
        ) : null}
      </PageHeader>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">{t("accounts.tabs.accounts")}</TabsTrigger>
          <TabsTrigger value="mappings">{t("accounts.tabs.mappings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <ResourceTable
            columns={columns}
            rows={accounts ?? []}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={error ? errorMessage(error) : null}
            emptyTitle={t("accounts.emptyTitle")}
            emptyDescription={t("accounts.emptyDescription")}
          />
        </TabsContent>

        <TabsContent value="mappings">
          <Card>
            <CardHeader>
              <CardTitle>{t("accounts.mappingsTitle")}</CardTitle>
              <CardDescription>{t("accounts.mappingsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {ACCOUNT_MAPPING_KEYS.map((key) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium">{t(`mappingKeys.${key}`)}</label>
                  <Select
                    value={mappingByKey.get(key) ?? ""}
                    onValueChange={(accountId) => setMapping.mutate({ key, accountId })}
                    disabled={!can("accounting.write")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("accounts.notConfigured")} />
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
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AccountDialog open={open} onOpenChange={setOpen} accounts={accounts ?? []} />
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
  accounts: Account[];
}) {
  const { t } = useTranslation("accounting");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    name: "",
    accountType: "ASSET" as (typeof ACCOUNT_TYPES)[number],
    parentId: "",
    isGroup: false,
  });

  const mutation = useMutation({
    mutationFn: () => accountingApi.createAccount({ ...form, parentId: form.parentId || null }),
    onSuccess: () => {
      toast.success(t("accounts.created"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      onOpenChange(false);
      setForm({ code: "", name: "", accountType: "ASSET", parentId: "", isGroup: false });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("accounts.newAccount")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label={t("columns.accountNumber")} required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                required
                className="tabular"
              />
            </Field>
            <Field label={t("columns.nature")} required>
              <Select
                value={form.accountType}
                onValueChange={(value) =>
                  setForm({ ...form, accountType: value as (typeof ACCOUNT_TYPES)[number] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`accountTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label={t("columns.accountName")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label={t("accounts.dialog.parentAccount")}>
            <Select
              value={form.parentId || "NONE"}
              onValueChange={(value) =>
                setForm({ ...form, parentId: value === "NONE" ? "" : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("common:states.none")}</SelectItem>
                {accounts
                  .filter((account) => account.isGroup)
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isGroup}
              onCheckedChange={(checked) => setForm({ ...form, isGroup: checked === true })}
            />
            {t("accounts.dialog.isGroup")}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.code.trim() || !form.name.trim()}
            >
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
