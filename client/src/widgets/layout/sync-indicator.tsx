/**
 * Indicateur d'état de synchronisation ([FR-SYNC-6]).
 *
 * C'est le seul retour visuel dont dispose un vendeur pour savoir si ses ventes sont
 * remontées. Il doit donc être **explicite** : nombre d'opérations en attente, erreurs,
 * date de dernière synchronisation, et une action manuelle de relance.
 */

import { IconAlertTriangle, IconCloudCheck, IconCloudOff, IconRefresh } from "@tabler/icons-react";
import { Link } from "wouter";

import { formatDateTime } from "@shared/format";
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
      ? "Hors ligne"
      : tone === "error"
        ? `${failed} erreur${failed > 1 ? "s" : ""}`
        : tone === "syncing"
          ? "Synchronisation…"
          : pending > 0
            ? `${pending} en attente`
            : "À jour";

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
          aria-label={`État de synchronisation : ${label}`}
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
            {online ? "Connecté au serveur" : "Mode hors ligne"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {online
              ? "Les ventes sont remontées automatiquement."
              : "Les ventes sont enregistrées localement et remonteront au retour du réseau."}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-1 px-2 py-1.5 text-xs">
          <Row label="En attente" value={String(pending)} />
          <Row label="En erreur" value={String(failed)} tone={failed > 0 ? "danger" : undefined} />
          <Row
            label="Dernière synchro."
            value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "jamais"}
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
          Synchroniser maintenant
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/sync">Voir la file d'attente</Link>
        </DropdownMenuItem>
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

/** Bandeau permanent affiché tant que le poste travaille sans réseau. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-offline px-4 py-1.5 text-center text-xs font-medium text-offline-foreground print-hidden"
    >
      <IconCloudOff className="size-3.5" />
      Mode hors ligne — vos saisies sont enregistrées sur ce poste et seront synchronisées
      automatiquement.
    </div>
  );
}
