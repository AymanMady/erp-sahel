/** Purchase order detail: receiving and invoicing. */

import { useState } from "react";
import {
  IconArrowLeft,
  IconFileInvoice,
  IconPackageImport,
  IconPrinter,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { normalizeQuantity } from "@shared/money";
import { formatDate, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { DocumentView } from "@/features/documents/document-view";
import { Field } from "@/shared/components/field";
import { Money, Quantity } from "@/shared/components/money";
import { MoneyInput, QuantityInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { StatusBadge } from "@/shared/components/status-badge";
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
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export default function PurchaseOrderDetailPage() {
  const { t } = useTranslation("purchasing");
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [receiveOpen, setReceiveOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.purchaseOrder(params.id),
    queryFn: () => purchasingApi.getOrder(params.id),
    enabled: Boolean(params.id),
  });

  const { data: receipts } = useQuery({
    queryKey: queryKeys.goodsReceipts({ orderId: params.id }),
    queryFn: () => purchasingApi.listReceipts(params.id),
    enabled: Boolean(params.id),
  });

  const invoice = useMutation({
    mutationFn: () =>
      purchasingApi.createSupplierInvoice({
        supplierId: data?.supplierId,
        purchaseOrderId: data?.id,
        date: todayInput(),
        lines: (data?.lines ?? []).map((line) => ({
          productId: line.productId,
          description: line.description,
          productSku: line.productSku,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          discountBp: line.discountBp,
          vatRateBp: line.vatRateBp,
        })),
      }),
    onSuccess: () => {
      toast.success(t("orderDetail.invoiceCreated"));
      void queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error ? errorMessage(error) : t("orderDetail.notFound")}
        </CardContent>
      </Card>
    );
  }

  const fullyReceived = data.lines.every(
    (line) => normalizeQuantity(line.receivedQuantity) >= normalizeQuantity(line.quantity)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("orderDetail.title", { number: data.number })}
        description={data.supplierName}
        className="print-hidden"
      >
        <Button variant="outline" asChild>
          <Link href="/purchase-orders">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <IconPrinter className="size-4" />
          {t("common:actions.print")}
        </Button>
        {can("purchasing.write") && !fullyReceived ? (
          <Button onClick={() => setReceiveOpen(true)}>
            <IconPackageImport className="size-4" />
            {t("orderDetail.receive")}
          </Button>
        ) : null}
        {can("purchasing.write") ? (
          <Button variant="outline" onClick={() => invoice.mutate()} disabled={invoice.isPending}>
            <IconFileInvoice className="size-4" />
            {t("orderDetail.supplierInvoice")}
          </Button>
        ) : null}
      </PageHeader>

      <DocumentView
        title={t("orderDetail.documentTitle")}
        number={data.number}
        date={data.date}
        dueDate={data.expectedDate}
        partyName={data.supplierName}
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
        }))}
        totalHtCents={data.totalHtCents}
        totalVatCents={data.totalVatCents}
        totalTtcCents={data.totalTtcCents}
        notes={data.notes}
      />

      <Card className="print-hidden">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">{t("orderDetail.receiptProgress")}</p>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>{t("orderDetail.item")}</TableHead>
                  <TableHead className="text-end">{t("orderDetail.ordered")}</TableHead>
                  <TableHead className="text-end">{t("orderDetail.received")}</TableHead>
                  <TableHead className="text-end">{t("orderDetail.remaining")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line) => {
                  const ordered = normalizeQuantity(line.quantity);
                  const received = normalizeQuantity(line.receivedQuantity);
                  return (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-end">
                        <Quantity value={ordered} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Quantity value={received} />
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={
                            received < ordered ? "text-status-pending" : "text-status-success"
                          }
                        >
                          <Quantity value={Math.max(0, ordered - received)} />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {(receipts?.length ?? 0) > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("orderDetail.receipts")}</p>
              {receipts?.map((receipt) => (
                <div key={receipt.id} className="rounded-md border px-3 py-2 text-sm">
                  <span className="tabular font-medium">{receipt.number}</span>
                  <span className="ms-2 text-muted-foreground">{formatDate(receipt.date)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        order={data}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrder(params.id) });
          void queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
          void queryClient.invalidateQueries({ queryKey: ["stock"] });
        }}
      />
    </div>
  );
}

function ReceiveDialog({
  open,
  onOpenChange,
  order,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: string;
    supplierId: string;
    warehouseId: string | null;
    lines: {
      id: string;
      productId: string | null;
      description: string;
      quantity: string;
      receivedQuantity: string;
      unitPriceCents: number;
    }[];
  };
  onDone: () => void;
}) {
  const { t } = useTranslation("purchasing");
  const [date, setDate] = useState(todayInput());
  const [lines, setLines] = useState(() =>
    order.lines
      .filter((line) => line.productId)
      .map((line) => ({
        purchaseOrderLineId: line.id,
        productId: line.productId as string,
        description: line.description,
        // Default to the remaining quantity — the most common action.
        quantity: String(
          Math.max(0, normalizeQuantity(line.quantity) - normalizeQuantity(line.receivedQuantity))
        ),
        unitCostCents: line.unitPriceCents,
        lotNumber: "",
      }))
  );

  const mutation = useMutation({
    mutationFn: () =>
      purchasingApi.createReceipt({
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        warehouseId: order.warehouseId,
        date,
        lines: lines
          .filter((line) => Number(line.quantity) > 0)
          .map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            productId: line.productId,
            quantity: line.quantity,
            unitCostCents: line.unitCostCents,
            lotNumber: line.lotNumber,
          })),
      }),
    onSuccess: () => {
      toast.success(t("receiveDialog.validated"));
      onDone();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("receiveDialog.title")}</DialogTitle>
          <DialogDescription>{t("receiveDialog.description")}</DialogDescription>
        </DialogHeader>

        <Field label={t("receiveDialog.receiptDate")}>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>

        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>{t("orderDetail.item")}</TableHead>
                <TableHead className="w-28 text-end">{t("common:labels.quantity")}</TableHead>
                <TableHead className="w-32 text-end">{t("receiveDialog.unitCost")}</TableHead>
                <TableHead className="w-32">{t("receiveDialog.lot")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.purchaseOrderLineId}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>
                    <QuantityInput
                      value={line.quantity}
                      onChange={(value) =>
                        setLines((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, quantity: value } : entry
                          )
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      valueCents={line.unitCostCents}
                      onChange={(cents) =>
                        setLines((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, unitCostCents: cents } : entry
                          )
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.lotNumber}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, lotNumber: event.target.value }
                              : entry
                          )
                        )
                      }
                      placeholder={t("receiveDialog.optional")}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("receiveDialog.receivedValue")}</span>
          <Money
            cents={lines.reduce(
              (sum, line) => sum + Math.round(Number(line.quantity) * line.unitCostCents),
              0
            )}
            className="font-medium"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || lines.every((line) => Number(line.quantity) <= 0)}
          >
            {t("receiveDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
