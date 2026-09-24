/**
 * Synchronization monitoring.
 *
 * Two complementary views:
 *  - the **local queue** (this device): pending, failed and already uploaded operations;
 *  - the **server journal**: what the server has ingested, across all devices.
 *
 * This is the field diagnostic screen: "has my sale been sent?" must be answered at a
 * glance ([FR-SYNC-6]).
 */

import { useCallback, useEffect, useState } from "react";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDateTime } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { syncApi } from "@/entities/sync/api";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatCard } from "@/shared/components/stat-card";
import { StatusBadge } from "@/shared/components/status-badge";
import { useOnline } from "@/shared/hooks/use-online";
import type { OutboxRecord } from "@/shared/offline/db";
import { discard, listAll, retryFailed } from "@/shared/offline/outbox";
import {
  getSyncStatus,
  onSyncStatusChange,
  refreshCounters,
  runSync,
  type SyncStatus,
} from "@/shared/offline/sync-engine";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/** Synchronization entity → key in `sync:entities`. */
const ENTITY_LABEL_KEYS: Record<string, string> = {
  "core.party": "party",
  "catalog.product": "product",
  "sales.quote": "quote",
  "invoicing.sales_invoice": "invoice",
  "payments.payment": "payment",
  "pos.session_open": "posSessionOpen",
  "pos.session_close": "posSessionClose",
  "inventory.stock_movement": "stockMovement",
  "http.request": "offlineEntry",
};

export default function SyncPage() {
  const { t } = useTranslation("sync");
  const online = useOnline();
  const entityLabel = (entity: string) =>
    ENTITY_LABEL_KEYS[entity] ? t(`entities.${ENTITY_LABEL_KEYS[entity]}`) : entity;
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [loadingOutbox, setLoadingOutbox] = useState(true);

  const loadOutbox = useCallback(async () => {
    setLoadingOutbox(true);
    setOutbox(await listAll(200));
    setLoadingOutbox(false);
  }, []);

  useEffect(() => {
    const unsubscribe = onSyncStatusChange(setStatus);
    void loadOutbox();
    return unsubscribe;
  }, [loadOutbox]);

  const { data: serverStatus } = useQuery({
    queryKey: queryKeys.syncStatus,
    // Offline, the last known state is read back from the local cache.
    queryFn: () => syncApi.status(),
    retry: false,
  });

  const { data: journal, error: journalError } = useQuery({
    queryKey: ["sync-journal"],
    queryFn: () => syncApi.journal(),
    retry: false,
  });

  const outboxColumns: Column<OutboxRecord>[] = [
    {
      id: "label",
      header: t("columns.operation"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.label}</p>
          <p className="text-xs text-muted-foreground">
            {entityLabel(row.entity)} · {formatDateTime(row.createdAt)}
          </p>
        </div>
      ),
    },
    {
      id: "number",
      header: t("common:labels.number"),
      cell: (row) => (
        <div className="tabular text-sm">
          {row.assignedNumber ? (
            <span className="font-medium text-status-success">{row.assignedNumber}</span>
          ) : row.provisionalNumber ? (
            <span className="text-muted-foreground">{row.provisionalNumber}</span>
          ) : (
            "—"
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: t("columns.state"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "attempts",
      header: t("columns.attempts"),
      align: "center",
      hideOnMobile: true,
      cell: (row) => <span className="tabular">{row.attempts}</span>,
    },
    {
      id: "amount",
      header: t("common:labels.amount"),
      align: "end",
      cell: (row) =>
        row.amountCents != null ? (
          <Money cents={row.amountCents} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        row.status === "error" ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("discard")}
            onClick={async () => {
              await discard(row.clientUuid);
              await refreshCounters();
              await loadOutbox();
              toast.success(t("discarded"));
            }}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  const journalColumns: Column<NonNullable<typeof journal>[number]>[] = [
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDateTime(row.createdAt) },
    {
      id: "entity",
      header: t("columns.entity"),
      cell: (row) => <Badge variant="outline">{entityLabel(row.entity)}</Badge>,
    },
    {
      id: "number",
      header: t("columns.assignedNumber"),
      cell: (row) => <span className="tabular text-sm">{row.assignedNumber || "—"}</span>,
    },
    {
      id: "device",
      header: t("columns.device"),
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.deviceId || "—"}</span>,
    },
    {
      id: "status",
      header: t("columns.result"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "detail",
      header: t("columns.detail"),
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.detail || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")}>
        <Button
          variant="outline"
          onClick={async () => {
            await retryFailed();
            await refreshCounters();
            await loadOutbox();
            toast.success(t("retried"));
          }}
          disabled={status.failed === 0}
        >
          {t("retryErrors")}
        </Button>
        <Button
          onClick={async () => {
            await runSync({ force: true });
            await loadOutbox();
          }}
          disabled={!online || status.state === "syncing"}
        >
          <IconRefresh className="size-4" />
          {t("syncNow")}
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("stats.pending")} value={status.pending} invertTrend />
        <StatCard label={t("stats.failed")} value={status.failed} invertTrend />
        <StatCard
          label={t("stats.lastSync")}
          value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : t("never")}
        />
        <StatCard
          label={t("stats.state")}
          value={
            !online
              ? t("states.offline")
              : status.state === "syncing"
                ? t("states.syncing")
                : status.state === "error"
                  ? t("states.error")
                  : t("states.upToDate")
          }
        />
      </div>

      {status.lastError ? (
        <Card>
          <CardContent className="py-4 text-sm text-status-danger">{status.lastError}</CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="outbox">
        <TabsList>
          <TabsTrigger value="outbox">{t("tabs.outbox")}</TabsTrigger>
          <TabsTrigger value="journal">{t("tabs.journal")}</TabsTrigger>
          <TabsTrigger value="devices">{t("tabs.devices")}</TabsTrigger>
        </TabsList>

        <TabsContent value="outbox">
          <ResourceTable
            columns={outboxColumns}
            rows={outbox}
            rowKey={(row) => row.clientUuid}
            loading={loadingOutbox}
            emptyTitle={t("outbox.emptyTitle")}
            emptyDescription={t("outbox.emptyDescription")}
            minWidthClassName="min-w-[840px]"
          />
        </TabsContent>

        <TabsContent value="journal">
          <ResourceTable
            columns={journalColumns}
            rows={journal ?? []}
            rowKey={(row) => row.id}
            error={journalError ? errorMessage(journalError) : null}
            emptyTitle={t("journal.emptyTitle")}
            emptyDescription={t("journal.emptyDescription")}
            minWidthClassName="min-w-[900px]"
          />
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardHeader>
              <CardTitle>{t("devices.title")}</CardTitle>
              <CardDescription>{t("devices.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(serverStatus?.devices.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("devices.empty")}
                </p>
              ) : (
                serverStatus?.devices.map((device) => (
                  <div
                    key={device.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="tabular text-sm font-medium">{device.deviceId}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("devices.platform", { platform: device.platform })}
                      </p>
                    </div>
                    <div className="text-end text-xs text-muted-foreground">
                      <p>
                        {t("devices.lastPush", {
                          date: device.lastPushAt ? formatDateTime(device.lastPushAt) : t("never"),
                        })}
                      </p>
                      <p>
                        {t("devices.lastSnapshot", {
                          date: device.lastSnapshotAt
                            ? formatDateTime(device.lastSnapshotAt)
                            : t("never"),
                        })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
