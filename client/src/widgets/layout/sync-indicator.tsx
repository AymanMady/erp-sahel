/**
 * Sync status indicator ([FR-SYNC-6]).
 *
 * It is the only visual feedback a salesperson has to know whether their sales were
 * uploaded. It must therefore be **explicit**: number of pending operations, errors,
 * last sync date, and a manual retry action.
 */

import { useEffect, useRef } from "react";
import {
  IconAlertTriangle,
  IconCloudCheck,
  IconCloudDownload,
  IconCloudOff,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link } from "wouter";

import { formatDateTime } from "@shared/format";
import { useSession } from "@/shared/auth/session";
import { useOfflineReadiness } from "@/shared/hooks/use-offline-readiness";
import { useOnline } from "@/shared/hooks/use-online";
import { runSync } from "@/shared/offline/sync-engine";
import type { SyncStatus } from "@/shared/offline/sync-engine";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export function SyncIndicator({ status }: { status: SyncStatus }) {
  const online = useOnline();
  const { isSuperuser } = useSession();
  const readiness = useOfflineReadiness();
  const { t } = useTranslation("layout");
  const pending = status.pending;
  const failed = status.failed;

  const tone = !online
    ? "offline"
    : failed > 0
      ? "error"
      : status.state === "syncing"
        ? "syncing"
        : pending > 0
          ? "pending"
          : "idle";

  const label =
    tone === "offline"
      ? t("sync.offline")
      : tone === "error"
        ? t("sync.errors", { count: failed })
        : tone === "syncing"
          ? t("sync.syncing")
          : pending > 0
            ? t("sync.pendingCount", { count: pending })
            : t("sync.upToDate");

  const Icon =
    tone === "offline"
      ? IconCloudOff
      : tone === "error"
        ? IconAlertTriangle
        : tone === "syncing"
          ? IconRefresh
          : IconCloudCheck;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-2",
            tone === "offline" && "text-status-pending",
            tone === "error" && "text-status-danger",
            tone === "idle" && "text-muted-foreground"
          )}
          aria-label={t("sync.statusAria", { status: label })}
        >
          <Icon className={cn("size-4", tone === "syncing" && "animate-spin")} />
          <span className="hidden sm:inline">{label}</span>
          {pending > 0 && tone !== "offline" ? (
            <Badge variant="secondary" className="tabular">
              {pending}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">
            {online ? t("sync.connected") : t("sync.offlineMode")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {online ? t("sync.onlineHint") : t("sync.offlineHint")}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-1 px-2 py-1.5 text-xs">
          <Row label={t("sync.pending")} value={String(pending)} />
          <Row
            label={t("sync.failed")}
            value={String(failed)}
            tone={failed > 0 ? "danger" : undefined}
          />
          <Row
            label={t("sync.lastSync")}
            value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : t("sync.never")}
          />
          <Row
            label={t("offlineReady.label")}
            value={
              readiness.state === "ready"
                ? t("offlineReady.ready")
                : readiness.running
                  ? t("offlineReady.preparingShort", { percent: readiness.percent })
                  : t("offlineReady.notReady")
            }
            tone={readiness.state === "ready" ? undefined : "danger"}
          />
        </div>
        {status.lastError ? (
          <p className="px-2 pb-1.5 text-xs text-status-danger">{status.lastError}</p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void runSync({ force: true });
          }}
          disabled={!online || status.state === "syncing"}
        >
          <IconRefresh className="size-4" />
          {t("sync.syncNow")}
        </DropdownMenuItem>
        {isSuperuser ? (
          <DropdownMenuItem asChild>
            <Link href="/sync">{t("sync.viewQueue")}</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular font-medium", tone === "danger" && "text-status-danger")}>
        {value}
      </span>
    </div>
  );
}

/**
 * Permanent banner shown while the device works without network. It warns when the
 * device had not finished downloading everything before the network dropped.
 */
export function OfflineBanner() {
  const online = useOnline();
  const readiness = useOfflineReadiness();
  const { t } = useTranslation("layout");
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-offline px-4 py-1.5 text-center text-xs font-medium text-offline-foreground print-hidden"
    >
      <IconCloudOff className="size-3.5" />
      {readiness.state === "preparing" ? t("offlineReady.offlineNotReady") : t("offlineBanner")}
    </div>
  );
}

/**
 * First download after sign-in: says how far it is, and when the device can work
 * without network. Without it, a user could leave the shop with a device that only
 * knows the screens already opened.
 */
export function OfflinePreparationBanner() {
  const online = useOnline();
  const readiness = useOfflineReadiness();
  const { t } = useTranslation("layout");

  const previous = useRef(readiness.state);
  useEffect(() => {
    if (previous.current === "preparing" && readiness.state === "ready") {
      toast.success(t("offlineReady.done"));
    }
    previous.current = readiness.state;
  }, [readiness.state, t]);

  if (!online || readiness.state !== "preparing" || !readiness.running) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-primary/10 px-4 py-1.5 text-center text-xs font-medium text-primary print-hidden"
    >
      <IconCloudDownload className="size-3.5 shrink-0" />
      {t("offlineReady.preparing", { percent: readiness.percent })}
    </div>
  );
}
