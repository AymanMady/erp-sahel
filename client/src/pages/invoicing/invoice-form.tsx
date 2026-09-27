/**
 * Customer invoice creation.
 *
 * Two distinct actions, deliberately kept apart: **save a draft** (no effect) and
 * **validate** (legal number, stock decrement, accounting entry, locked document).
 * Making them look alike would get invoices validated by accident.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconArrowLeft, IconCheck, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import { addDays, todayInput } from "@shared/format";
import { formatMoney } from "@shared/money";
import { computeDocumentTotals } from "@shared/pricing";
import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import { invoicingApi } from "@/entities/invoicing/api";
import { queueHttpWrite } from "@/shared/offline/offline-http";
import { newUuid, onlineOrQueued, queueInvoiceCreate } from "@/shared/offline/offline-writes";
import type { Party } from "@/entities/types";
import { invalidateMoneyAndStock, queryKeys } from "@/shared/api/query-client";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import {
  LineEditor,
  emptyLine,
  documentBlocker,
  toApiLines,
  type DocumentLine,
} from "@/features/documents/line-editor";
import { PartyPicker } from "@/features/documents/party-picker";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const DEFAULT_WAREHOUSE = "DEFAULT";

export default function InvoiceFormPage() {
  const { t } = useTranslation("invoicing");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [party, setParty] = useState<Party | null>(null);
  const [date, setDate] = useState(todayInput());
  const [dueDate, setDueDate] = useState("");
  const [warehouseId, setWarehouseId] = useState(DEFAULT_WAREHOUSE);
  const [notes, setNotes] = useState("");
  const [globalDiscountBp, setGlobalDiscountBp] = useState(0);
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine()]);

  const [confirmDialog, confirm] = useConfirm();

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const submit = useMutation({
    mutationFn: (validate: boolean) => {
      const input = {
        partyId: party?.id as string,
        date,
        dueDate: dueDate || null,
        warehouseId: warehouseId === DEFAULT_WAREHOUSE ? null : warehouseId,
        notes,
        globalDiscountBp,
        lines: toApiLines(lines),
      };
      return onlineOrQueued(
        () => invoicingApi.create({ ...input, validate }),
        async (): Promise<{ provisionalNumber: string; draft?: boolean }> => {
          // An invoice validated offline goes through the dedicated sync operation
          // (number, stock, accounting); a draft, which commits nothing, is simply
          // replayed as-is once the network is back.
          if (!validate) {
            await queueHttpWrite(
              { method: "POST", url: "/api/invoices", body: { ...input, validate: false } },
              newUuid()
            );
            return { provisionalNumber: "", draft: true };
          }
          return queueInvoiceCreate(input);
        }
      );
    },
    onSuccess: (outcome) => {
      // A validated invoice takes goods out of stock and adds to the customer's debt.
      invalidateMoneyAndStock(queryClient);
      if (outcome.mode === "offline" && outcome.result.draft) {
        toast.success(t("invoiceForm.draftSavedOffline"), {
          description: t("invoiceForm.draftSavedOfflineDescription"),
        });
        navigate("/invoices");
        return;
      }
      if (outcome.mode === "offline") {
        toast.success(t("invoiceForm.savedOffline", { number: outcome.result.provisionalNumber }), {
          description: t("invoiceForm.savedOfflineDescription"),
        });
        navigate("/invoices");
        return;
      }
      const invoice = outcome.result;
      toast.success(
        invoice.status === "DRAFT"
          ? t("invoiceForm.draftSaved")
          : t("invoiceForm.validated", { number: invoice.number })
      );
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Said in words next to the greyed-out buttons.
  const blocker = documentBlocker({ party, lines });
  const canSubmit = !blocker;

  const validate = async () => {
    const { totalCents } = computeDocumentTotals(
      toApiLines(lines).map((line) => ({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountBp: line.discountBp,
      })),
      { globalDiscountBp }
    );
    const confirmed = await confirm({
      title: t("invoiceForm.confirmValidate.title", { amount: formatMoney(totalCents) }),
      description: t("invoiceForm.confirmValidate.description"),
      confirmLabel: t("invoiceForm.validate"),
    });
    if (confirmed) submit.mutate(true);
  };

  // Due date derived from the customer's payment terms as soon as one is picked.
  const applyParty = (next: Party | null) => {
    setParty(next);
    if (next && next.paymentTermsDays > 0) setDueDate(addDays(date, next.paymentTermsDays));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("invoiceForm.title")} description={t("invoiceForm.description")}>
        <Button variant="outline" asChild>
          <Link href="/invoices">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => submit.mutate(false)}
          disabled={!canSubmit || submit.isPending}
        >
          <IconDeviceFloppy className="size-4" />
          {t("invoiceForm.saveDraft")}
        </Button>
        <Button onClick={() => void validate()} disabled={!canSubmit || submit.isPending}>
          <IconCheck className="size-4" />
          {submit.isPending ? t("invoiceForm.processing") : t("invoiceForm.validate")}
        </Button>
      </PageHeader>
      {blocker ? (
        <p role="status" className="-mt-4 text-sm text-muted-foreground">
          {blocker}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("invoiceForm.header")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGrid columns={3}>
            <Field label={t("common:labels.customer")} required>
              <PartyPicker value={party} onChange={applyParty} role="CUSTOMER" />
            </Field>
            <Field label={t("invoiceForm.date")}>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label={t("common:labels.dueDate")}>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
            <Field label={t("invoiceForm.warehouse")} hint={t("invoiceForm.warehouseHint")}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_WAREHOUSE}>
                    {t("invoiceForm.defaultWarehouse")}
                  </SelectItem>
                  {(warehouses ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoiceForm.lines")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LineEditor
            lines={lines}
            onChange={setLines}
            globalDiscountBp={globalDiscountBp}
            onGlobalDiscountChange={setGlobalDiscountBp}
          />
          <Field label={t("common:labels.notes")}>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
