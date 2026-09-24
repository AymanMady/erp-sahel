/** Quote detail: view, status change and conversion into an order. */

import { IconArrowLeft, IconPrinter, IconTransform } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";

import { QUOTE_STATUSES } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { salesApi } from "@/entities/sales/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { DocumentView } from "@/features/documents/document-view";
import { PageHeader } from "@/shared/components/page-header";
import { StatusBadge, statusLabel } from "@/shared/components/status-badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

export default function QuoteDetailPage() {
  const { t } = useTranslation("sales");
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.quote(params.id),
    queryFn: () => salesApi.getQuote(params.id),
    enabled: Boolean(params.id),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => salesApi.setQuoteStatus(params.id, status),
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.quote(params.id) });
      void queryClient.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const convert = useMutation({
    mutationFn: () => salesApi.convertQuote(params.id),
    onSuccess: (order) => {
      toast.success(t("quote.converted", { number: order.number }));
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      navigate(`/sales-orders/${order.id}`);
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error ? errorMessage(error) : t("quote.notFound")}
        </CardContent>
      </Card>
    );
  }

  const frozen = data.status === "CONVERTED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("quote.pageTitle", { number: data.number })}
        description={data.partyName}
        className="print-hidden"
      >
        <Button variant="outline" asChild>
          <Link href="/quotes">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <IconPrinter className="size-4" />
          {t("common:actions.print")}
        </Button>
        {can("sales.write") ? (
          <>
            <Select
              value={data.status}
              onValueChange={(value) => setStatus.mutate(value)}
              disabled={frozen}
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUOTE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => convert.mutate()}
              disabled={frozen || convert.isPending || data.status === "REJECTED"}
            >
              <IconTransform className="size-4" />
              {t("quote.convert")}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <DocumentView
        title={t("quote.documentTitle")}
        number={data.number}
        date={data.date}
        dueDate={data.expiryDate}
        partyName={data.partyName}
        badge={<StatusBadge status={data.status} />}
        lines={data.lines.map((line) => ({
          id: line.id,
          productSku: line.productSku ?? undefined,
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
        notes={data.notes}
        footerNote={t("quote.footerNote")}
      />
    </div>
  );
}
