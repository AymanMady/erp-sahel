/**
 * Plan comptable et comptes des automatismes.
 *
 * Le second bloc est ce qui rend le référentiel interchangeable ([BR-21]) : les
 * écritures automatiques désignent des **clés logiques**, et cet écran dit quel compte
 * sert chaque clé.
 */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Actif",
  LIABILITY: "Passif",
  EQUITY: "Capitaux propres",
  REVENUE: "Produits",
  EXPENSE: "Charges",
};

/** Libellés métier des clés d'automatisme, pour que l'écran reste compréhensible. */
const MAPPING_LABELS: Record<AccountMappingKey, string> = {
  SALES_REVENUE: "Ventes de marchandises",
  SALES_DISCOUNT: "Remises accordées",
  VAT_COLLECTED: "TVA facturée (collectée)",
  VAT_DEDUCTIBLE: "TVA récupérable (déductible)",
  CUSTOMER_RECEIVABLE: "Créances clients",
  SUPPLIER_PAYABLE: "Dettes fournisseurs",
  PURCHASES: "Achats de marchandises",
  INVENTORY: "Stock de marchandises",
  INVENTORY_VARIATION: "Variation de stock",
  CASH: "Caisse",
  BANK: "Banque",
  MOBILE_MONEY: "Mobile money",
  ROUNDING_DIFFERENCE: "Écarts et arrondis",
  OPENING_BALANCE: "Bilan d'ouverture",
  RESULT_CARRY_FORWARD: "Report à nouveau",
};

export default function ChartOfAccountsPage() {
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
      toast.success("Compte associé mis à jour.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.accountMappings });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const mappingByKey = new Map((mappings ?? []).map((entry) => [entry.key, entry.accountId]));

  const columns: Column<Account>[] = [
    {
      id: "code",
      header: "Numéro",
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    { id: "name", header: "Intitulé", cell: (row) => row.name },
    {
      id: "type",
      header: "Nature",
      cell: (row) => <Badge variant="outline">{ACCOUNT_TYPE_LABELS[row.accountType]}</Badge>,
    },
    {
      id: "group",
      header: "Regroupement",
      align: "center",
      hideOnMobile: true,
      cell: (row) => (row.isGroup ? "Oui" : "—"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan comptable"
        description="Référentiel de la société et comptes utilisés par les écritures automatiques."
      >
        {can("accounting.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouveau compte
          </Button>
        ) : null}
      </PageHeader>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Comptes</TabsTrigger>
          <TabsTrigger value="mappings">Automatismes</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <ResourceTable
            columns={columns}
            rows={accounts ?? []}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={error ? errorMessage(error) : null}
            emptyTitle="Plan comptable vide"
            emptyDescription="Le plan est installé automatiquement à la création de la société."
          />
        </TabsContent>

        <TabsContent value="mappings">
          <Card>
            <CardHeader>
              <CardTitle>Comptes des écritures automatiques</CardTitle>
              <CardDescription>
                Les factures et règlements désignent une clé logique ; c'est ici qu'elle est reliée
                à un compte du plan. Changer de référentiel comptable revient à modifier ces
                associations.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {ACCOUNT_MAPPING_KEYS.map((key) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium">{MAPPING_LABELS[key]}</label>
                  <Select
                    value={mappingByKey.get(key) ?? ""}
                    onValueChange={(accountId) => setMapping.mutate({ key, accountId })}
                    disabled={!can("accounting.write")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Non configuré" />
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
      toast.success("Compte créé.");
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
          <DialogTitle>Nouveau compte</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Numéro" required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                required
                className="tabular"
              />
            </Field>
            <Field label="Nature" required>
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
                      {ACCOUNT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label="Intitulé" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Compte parent">
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
                <SelectItem value="NONE">Aucun</SelectItem>
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
            Compte de regroupement (ne reçoit pas d'écriture)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.code.trim() || !form.name.trim()}
            >
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
