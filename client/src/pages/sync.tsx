/**
 * Supervision de la synchronisation.
 *
 * Deux vues complémentaires :
 *  - la **file locale** (ce poste) : opérations en attente, en erreur, déjà remontées ;
 *  - le **journal serveur** : ce que le serveur a ingéré, tous postes confondus.
 *
 * C'est l'écran de diagnostic terrain : « ma vente est-elle partie ? » doit avoir une
 * réponse en un coup d'œil ([FR-SYNC-6]).
 */

import { useCallback, useEffect, useState } from "react";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
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

const ENTITY_LABELS: Record<string, string> = {
  "core.party": "Tiers",
  "catalog.product": "Produit",
  "sales.quote": "Devis",
  "invoicing.sales_invoice": "Facture",
  "payments.payment": "Règlement",
  "pos.session_open": "Ouverture de caisse",
  "pos.session_close": "Clôture de caisse",
  "inventory.stock_movement": "Mouvement de stock",
};

export default function SyncPage() {
  const online = useOnline();
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
    queryFn: () => syncApi.status(),
    enabled: online,
    retry: false,
  });

  const { data: journal, error: journalError } = useQuery({
    queryKey: ["sync-journal"],
    queryFn: () => syncApi.journal(),
    enabled: online,
    retry: false,
  });

  const outboxColumns: Column<OutboxRecord>[] = [
    {
      id: "label",
      header: "Opération",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.label}</p>
          <p className="text-xs text-muted-foreground">
            {ENTITY_LABELS[row.entity] ?? row.entity} · {formatDateTime(row.createdAt)}
          </p>
        </div>
      ),
    },
    {
      id: "number",
      header: "Numéro",
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
    { id: "status", header: "État", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "attempts",
      header: "Tentatives",
      align: "center",
      hideOnMobile: true,
      cell: (row) => <span className="tabular">{row.attempts}</span>,
    },
    {
      id: "amount",
      header: "Montant",
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
            aria-label="Abandonner"
            onClick={async () => {
              await discard(row.clientUuid);
              await refreshCounters();
              await loadOutbox();
              toast.success("Opération abandonnée.");
            }}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  const journalColumns: Column<NonNullable<typeof journal>[number]>[] = [
    { id: "date", header: "Date", cell: (row) => formatDateTime(row.createdAt) },
    {
      id: "entity",
      header: "Entité",
      cell: (row) => <Badge variant="outline">{ENTITY_LABELS[row.entity] ?? row.entity}</Badge>,
    },
    {
      id: "number",
      header: "Numéro attribué",
      cell: (row) => <span className="tabular text-sm">{row.assignedNumber || "—"}</span>,
    },
    {
      id: "device",
      header: "Poste",
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.deviceId || "—"}</span>,
    },
    { id: "status", header: "Résultat", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "detail",
      header: "Détail",
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.detail || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Synchronisation"
        description="File d'attente de ce poste et journal d'ingestion du serveur."
      >
        <Button
          variant="outline"
          onClick={async () => {
            await retryFailed();
            await refreshCounters();
            await loadOutbox();
            toast.success("Opérations en erreur remises en file.");
          }}
          disabled={status.failed === 0}
        >
          Réessayer les erreurs
        </Button>
        <Button
          onClick={async () => {
            await runSync({ force: true });
            await loadOutbox();
          }}
          disabled={!online || status.state === "syncing"}
        >
          <IconRefresh className="size-4" />
          Synchroniser
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="En attente sur ce poste" value={status.pending} invertTrend />
        <StatCard label="En erreur" value={status.failed} invertTrend />
        <StatCard
          label="Dernière synchronisation"
          value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "jamais"}
        />
        <StatCard
          label="État"
          value={
            !online
              ? "Hors ligne"
              : status.state === "syncing"
                ? "En cours"
                : status.state === "error"
                  ? "Erreur"
                  : "À jour"
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
          <TabsTrigger value="outbox">File locale</TabsTrigger>
          <TabsTrigger value="journal">Journal serveur</TabsTrigger>
          <TabsTrigger value="devices">Postes</TabsTrigger>
        </TabsList>

        <TabsContent value="outbox">
          <ResourceTable
            columns={outboxColumns}
            rows={outbox}
            rowKey={(row) => row.clientUuid}
            loading={loadingOutbox}
            emptyTitle="File vide"
            emptyDescription="Toutes les opérations de ce poste ont été synchronisées."
            minWidthClassName="min-w-[840px]"
          />
        </TabsContent>

        <TabsContent value="journal">
          <ResourceTable
            columns={journalColumns}
            rows={journal ?? []}
            rowKey={(row) => row.id}
            error={journalError ? errorMessage(journalError) : null}
            emptyTitle="Journal vide"
            emptyDescription="Aucune opération hors-ligne n'a encore été ingérée."
            minWidthClassName="min-w-[900px]"
          />
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardHeader>
              <CardTitle>Postes synchronisés</CardTitle>
              <CardDescription>
                Dernière remontée et dernier instantané servi, par poste.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(serverStatus?.devices.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun poste enregistré.
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
                        Plateforme : {device.platform}
                      </p>
                    </div>
                    <div className="text-end text-xs text-muted-foreground">
                      <p>
                        Dernier envoi :{" "}
                        {device.lastPushAt ? formatDateTime(device.lastPushAt) : "jamais"}
                      </p>
                      <p>
                        Dernier instantané :{" "}
                        {device.lastSnapshotAt ? formatDateTime(device.lastSnapshotAt) : "jamais"}
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
