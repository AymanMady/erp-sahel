/**
 * Database management — platform super-administrator only.
 *
 * Everything technical in one place: what the database holds, a full backup to keep
 * somewhere safe, putting a backup back (it replaces everything), and small upkeep
 * operations. Company administrators never see this screen; the server refuses its
 * calls to anyone else anyway.
 */

import { useState } from "react";
import {
  IconAlertTriangle,
  IconDatabaseExport,
  IconDatabaseImport,
  IconFileZip,
  IconLock,
  IconLogout,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDateTime, todayInput } from "@shared/format";
import { formatLocale } from "@shared/intl";
import { systemApi, type DatabaseOverview, type MaintenanceAction } from "@/entities/system/api";
import { errorMessage } from "@/shared/api/api-error";
import { useSession } from "@/shared/auth/session";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatCard } from "@/shared/components/stat-card";
import { useOnline } from "@/shared/hooks/use-online";
import { saveFile } from "@/shared/lib/download";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";

type TableRow = DatabaseOverview["tables"][number];

function formatCount(value: number): string {
  return new Intl.NumberFormat(formatLocale()).format(value);
}

function formatBytes(bytes: number, units: string[]): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

const MAINTENANCE: { action: MaintenanceAction; icon: typeof IconSparkles; confirm?: boolean }[] = [
  { action: "analyze", icon: IconSparkles },
  { action: "purge-expired", icon: IconTrash },
  { action: "unlock-sign-in", icon: IconLock },
  { action: "end-all-sessions", icon: IconLogout, confirm: true },
];

export default function DatabasePage() {
  const { t } = useTranslation("system");
  const online = useOnline();
  const { logout } = useSession();
  const [confirmDialog, confirm] = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [understood, setUnderstood] = useState(false);

  const overview = useQuery({
    queryKey: ["system-overview"],
    queryFn: () => systemApi.overview(),
    retry: false,
  });
  const units = t("units", { returnObjects: true }) as string[];
  const bytes = (value: number) => formatBytes(value, units);

  const backup = useMutation({
    mutationFn: () => systemApi.backup(),
    onSuccess: (blob) => {
      saveFile(blob, `sauvegarde-erp-${todayInput()}.json.gz`);
      toast.success(t("backup.done"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const restore = useMutation({
    mutationFn: (chosen: File) => systemApi.restore(chosen),
    onSuccess: async (result) => {
      toast.success(t("restore.done"), {
        description: t("restore.doneDescription", { rows: formatCount(result.rows) }),
      });
      // Every session ended with the old data, this one included.
      await logout();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const maintenance = useMutation({
    mutationFn: (action: MaintenanceAction) => systemApi.maintenance(action),
    onSuccess: (result, action) => {
      toast.success(t(`maintenance.${action}.done`, { count: result.affected }));
      void overview.refetch();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = overview.data;

  const columns: Column<TableRow>[] = [
    {
      id: "name",
      header: t("tables.name"),
      cell: (row) => <span className="font-mono text-sm">{row.name}</span>,
    },
    {
      id: "rows",
      header: t("tables.rows"),
      align: "end",
      cell: (row) => <span className="tabular">{formatCount(row.rows)}</span>,
    },
    {
      id: "size",
      header: t("tables.size"),
      align: "end",
      cell: (row) => <span className="tabular">{bytes(row.sizeBytes)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.size")}
          value={data ? bytes(data.database.sizeBytes) : "—"}
          loading={overview.isLoading}
        />
        <StatCard
          label={t("stats.companies")}
          value={data ? formatCount(data.counts.companies) : "—"}
          loading={overview.isLoading}
        />
        <StatCard
          label={t("stats.users")}
          value={data ? formatCount(data.counts.users) : "—"}
          loading={overview.isLoading}
        />
        <StatCard
          label={t("stats.sessions")}
          value={data ? formatCount(data.counts.activeSessions) : "—"}
          loading={overview.isLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("backup.title")}</CardTitle>
            <CardDescription>{t("backup.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => backup.mutate()} disabled={!online || backup.isPending}>
              <IconDatabaseExport className="size-4" />
              {backup.isPending ? t("backup.running") : t("backup.action")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("backup.hint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("restore.title")}</CardTitle>
            <CardDescription>{t("restore.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <IconAlertTriangle className="size-4" />
              <AlertTitle>{t("restore.warningTitle")}</AlertTitle>
              <AlertDescription>{t("restore.warning")}</AlertDescription>
            </Alert>

            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm transition-colors hover:bg-muted">
              <IconFileZip className="size-5 shrink-0" />
              <span className="min-w-0 truncate">{file ? file.name : t("restore.choose")}</span>
              <input
                type="file"
                accept=".gz,.json,application/gzip,application/json"
                className="hidden"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  restore.reset();
                  event.target.value = "";
                }}
              />
            </label>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={understood}
                onCheckedChange={(checked) => setUnderstood(checked === true)}
                className="mt-0.5"
              />
              {t("restore.understood")}
            </label>

            <Button
              variant="destructive"
              disabled={!file || !understood || !online || restore.isPending}
              onClick={async () => {
                if (!file) return;
                const accepted = await confirm({
                  title: t("restore.confirmTitle"),
                  description: t("restore.confirmDescription", { file: file.name }),
                  confirmLabel: t("restore.confirmAction"),
                  destructive: true,
                });
                if (accepted) restore.mutate(file);
              }}
            >
              <IconDatabaseImport className="size-4" />
              {restore.isPending ? t("restore.running") : t("restore.action")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("maintenance.title")}</CardTitle>
          <CardDescription>{t("maintenance.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {MAINTENANCE.map(({ action, icon: Icon, confirm: mustConfirm }) => (
            <div
              key={action}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(`maintenance.${action}.title`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`maintenance.${action}.description`)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!online || maintenance.isPending}
                onClick={async () => {
                  if (
                    mustConfirm &&
                    !(await confirm({
                      title: t(`maintenance.${action}.title`),
                      description: t(`maintenance.${action}.description`),
                      destructive: true,
                    }))
                  ) {
                    return;
                  }
                  maintenance.mutate(action);
                }}
              >
                <Icon className="size-4" />
                {t("maintenance.run")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("info.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data ? (
              <dl className="grid gap-x-10 gap-y-2 text-sm md:grid-cols-2">
                <InfoRow label={t("info.databaseName")} value={data.database.name} />
                <InfoRow label={t("info.databaseVersion")} value={data.database.version} />
                <InfoRow
                  label={t("info.migrations")}
                  value={
                    data.database.migrations === null
                      ? t("info.unknown")
                      : formatCount(data.database.migrations)
                  }
                />
                <InfoRow
                  label={t("info.lastMigration")}
                  value={
                    data.database.lastMigrationAt
                      ? formatDateTime(data.database.lastMigrationAt)
                      : t("info.unknown")
                  }
                />
                <InfoRow label={t("info.environment")} value={data.server.environment} />
                <InfoRow label={t("info.node")} value={data.server.nodeVersion} />
                <InfoRow label={t("info.system")} value={data.server.platform} />
                <InfoRow label={t("info.memory")} value={bytes(data.server.memoryBytes)} />
                <InfoRow
                  label={t("info.uptime")}
                  value={t("info.hours", {
                    count: Math.floor(data.server.uptimeSeconds / 3600),
                  })}
                />
              </dl>
            ) : overview.error ? (
              <p className="text-sm text-status-danger">{errorMessage(overview.error)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("info.loading")}</p>
            )}
          </CardContent>
        </Card>

        <div>
          <ResourceTable
            columns={columns}
            rows={data?.tables ?? []}
            rowKey={(row) => row.name}
            loading={overview.isLoading}
            error={overview.error ? errorMessage(overview.error) : null}
            emptyTitle={t("tables.emptyTitle")}
            emptyDescription={t("tables.emptyDescription")}
          />
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-end font-medium">{value}</dd>
    </div>
  );
}
