/** Invoice detail: validation, payment and credit note issuing. */

import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  IconArrowLeft,
  IconCheck,
  IconPrinter,
  IconReceipt,
  IconReceiptRefund,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { toast } from "sonner";

import { PAYMENT_METHODS, type PaymentMethod } from "@shared/schema";
import { todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { bankingApi } from "@/entities/banking/api";
import { invoicingApi } from "@/entities/invoicing/api";
import { paymentApi } from "@/entities/payment/api";
import { onlineOrQueued, queuePaymentCreate } from "@/shared/offline/offline-writes";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { DocumentView } from "@/features/documents/document-view";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { StatusBadge, paymentMethodLabel } from "@/shared/components/status-badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
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
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";

const DEFAULT_ACCOUNT = "DEFAULT";

export default function InvoiceDetailPage() {
  const { t } = useTranslation("invoicing");
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [payOpen, setPayOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.invoice(params.id),
    queryFn: () => invoicingApi.get(params.id),
    enabled: Boolean(params.id),
  });

  const { data: payments } = useQuery({
    queryKey: queryKeys.payments({ invoiceId: params.id }),
    queryFn: () => paymentApi.list({ invoiceId: params.id }),
    enabled: Boolean(params.id),
  });

  const validate = useMutation({
    mutationFn: () => invoicingApi.validate(params.id),
    onSuccess: (invoice) => {
      toast.success(t("invoice.validated", { number: invoice.number }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoice(params.id) });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error ? errorMessage(error) : t("invoice.notFound")}
        </CardContent>
      </Card>
    );
  }

  const remainingCents = Math.max(0, data.totalTtcCents - data.paidAmountCents);
  const isDraft = data.status === "DRAFT";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("invoice.pageTitle", { number: data.number })}
        description={data.partyName}
        className="print-hidden"
      >
        <Button variant="outline" asChild>
          <Link href="/invoices">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <IconPrinter className="size-4" />
          {t("common:actions.print")}
        </Button>
        {isDraft && can("invoicing.write") ? (
          <Button onClick={() => validate.mutate()} disabled={validate.isPending}>
            <IconCheck className="size-4" />
            {t("common:actions.validate")}
          </Button>
        ) : null}
        {!isDraft && remainingCents > 0 && can("payments.write") ? (
          <Button onClick={() => setPayOpen(true)}>
            <IconReceipt className="size-4" />
            {t("invoice.collect")}
          </Button>
        ) : null}
        {!isDraft && data.status !== "CANCELLED" && can("invoicing.cancel") ? (
          <Button variant="outline" onClick={() => setCreditOpen(true)}>
            <IconReceiptRefund className="size-4" />
            {t("invoice.issueCreditNote")}
          </Button>
        ) : null}
      </PageHeader>

      {isDraft ? (
        <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground print-hidden">
          <Trans t={t} i18nKey="invoice.draftNotice" components={{ strong: <strong /> }} />
        </div>
      ) : null}

      <DocumentView
        title={t("invoice.documentTitle")}
        number={data.number}
        date={data.date}
        dueDate={data.dueDate}
        partyName={data.partyName}
        badge={<StatusBadge status={data.status} />}
        lines={data.lines.map((line) => ({
          id: line.id,
          productSku: line.productSku || undefined,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          discountBp: line.discountBp,
          vatRateBp: line.vatRateBp,
          totalHtCents: line.totalHtCents,
          originCountry: line.originCountry,
        }))}
        totalHtCents={data.totalHtCents}
        totalVatCents={data.totalVatCents}
        totalTtcCents={data.totalTtcCents}
        paidAmountCents={data.paidAmountCents}
        notes={data.notes}
      />

      {(payments?.items.length ?? 0) > 0 ? (
        <Card className="print-hidden">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">{t("invoice.payments")}</p>
            {payments?.items.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <p className="tabular font-medium">{payment.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {payment.paymentDate} · {paymentMethodLabel(payment.paymentMethod)}
                    {payment.bankAccountName ? ` · ${payment.bankAccountName}` : ""}
                  </p>
                </div>
                <Money cents={payment.amountCents} className="font-medium" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoiceId={data.id}
        partyId={data.partyId}
        remainingCents={remainingCents}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.invoice(params.id) });
          void queryClient.invalidateQueries({ queryKey: ["payments"] });
          void queryClient.invalidateQueries({ queryKey: ["invoices"] });
        }}
      />

      <CreditNoteDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        invoiceId={data.id}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.invoice(params.id) });
          void queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
        }}
      />
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  partyId,
  remainingCents,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  partyId: string;
  remainingCents: number;
  onDone: () => void;
}) {
  const { t } = useTranslation("invoicing");
  const [amountCents, setAmountCents] = useState(remainingCents);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [bankAccountId, setBankAccountId] = useState(DEFAULT_ACCOUNT);
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInput());

  const { data: accounts } = useQuery({
    queryKey: queryKeys.bankAccounts,
    queryFn: () => bankingApi.listAccounts(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        partyId,
        invoiceId,
        amountCents,
        paymentMethod: method,
        bankAccountId: bankAccountId === DEFAULT_ACCOUNT ? null : bankAccountId,
        reference,
        paymentDate,
      };
      return onlineOrQueued(
        () => paymentApi.create({ direction: "IN", ...input }),
        () => queuePaymentCreate(input)
      );
    },
    onSuccess: (outcome) => {
      if (outcome.mode === "offline") {
        toast.success(t("payment.savedOffline"), {
          description: t("payment.savedOfflineDescription"),
        });
      } else {
        toast.success(t("payment.saved"));
      }
      onDone();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>
            {t("payment.remaining")} <Money cents={remainingCents} />
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldGrid>
            <Field label={t("common:labels.amount")} required>
              <MoneyInput valueCents={amountCents} onChange={setAmountCents} />
            </Field>
            <Field label={t("common:labels.date")}>
              <Input
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </Field>
            <Field label={t("payment.method")}>
              <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {paymentMethodLabel(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("payment.account")}>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_ACCOUNT}>{t("payment.defaultAccount")}</SelectItem>
                  {(accounts ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label={t("common:labels.reference")}>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t("payment.referencePlaceholder")}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || amountCents <= 0 || amountCents > remainingCents}
          >
            {t("payment.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditNoteDialog({
  open,
  onOpenChange,
  invoiceId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("invoicing");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);

  const mutation = useMutation({
    mutationFn: () => invoicingApi.createCreditNote({ invoiceId, reason, restock }),
    onSuccess: () => {
      toast.success(t("creditNote.issued"));
      onDone();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("creditNote.title")}</DialogTitle>
          <DialogDescription>{t("creditNote.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("creditNote.reason")}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("creditNote.reasonPlaceholder")}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={restock}
              onCheckedChange={(checked) => setRestock(checked === true)}
            />
            {t("creditNote.restock")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("creditNote.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
