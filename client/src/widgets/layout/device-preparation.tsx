/**
 * First opening of the desktop application: no screen is shown before the device holds
 * everything it needs to work without internet — first the company's local database
 * (products, customers, sales, purchases…), then the other pages (till, reports,
 * accounts, settings). One progress bar says how far it is.
 *
 * Without internet, or when the server could not give every page, the person may go on
 * without waiting: the download carries on behind, and the banner says how far it is.
 * The web application keeps its banner only: a browser opened once, somewhere, must not
 * be held up.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlertTriangle, IconCloudDownload, IconCloudOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSession } from "@/shared/auth/session";
import { isTauriDesktop } from "@/shared/desktop/desktop";
import { useLocalBootstrap } from "@/shared/hooks/use-local-bootstrap";
import { useOfflineReadiness } from "@/shared/hooks/use-offline-readiness";
import { useOnline } from "@/shared/hooks/use-online";
import { synchronize } from "@/shared/hooks/use-sync";
import { isLocalComplete } from "@/shared/offline/local/replication";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Share of the bar for the local database; the other pages take the rest. */
const LOCAL_SHARE = 0.5;

/** Company for which the person chose to go on without waiting, until the app closes. */
let skippedFor: string | null = null;

export function DevicePreparationGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation("layout");
  const companyId = useSession().company?.id ?? null;
  const readiness = useOfflineReadiness();
  const [skipped, setSkipped] = useState(() => companyId !== null && skippedFor === companyId);
  const preparing = isTauriDesktop() && !skipped && readiness.state !== "ready";

  const wasPreparing = useRef(false);
  useEffect(() => {
    if (preparing) {
      wasPreparing.current = true;
      return;
    }
    // Gone on without waiting: the banner announces the end instead.
    if (wasPreparing.current && !skipped) toast.success(t("offlineReady.done"));
    wasPreparing.current = false;
  }, [preparing, skipped, t]);

  if (!preparing) return <>{children}</>;
  // Not known yet (a few milliseconds): a device already prepared must not see the screen.
  if (readiness.state === "unknown") return <LoadingScreen />;
  return (
    <PreparationScreen
      companyId={companyId}
      onSkip={() => {
        skippedFor = companyId;
        setSkipped(true);
      }}
    />
  );
}

function LoadingScreen() {
  const { t } = useTranslation("layout");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">{t("boot.loading")}</p>
      </div>
    </div>
  );
}

function PreparationScreen({
  companyId,
  onSkip,
}: {
  companyId: string | null;
  onSkip: () => void;
}) {
  const { t } = useTranslation("layout");
  const online = useOnline();
  const readiness = useOfflineReadiness();
  const bootstrap = useLocalBootstrap();

  // The other pages are downloaded once the local database is done (or could not be).
  const pagesStarted = readiness.total > 0;
  const localDone = isLocalComplete() || pagesStarted;
  const local = localDone ? 1 : bootstrap.total > 0 ? bootstrap.rows / bootstrap.total : 0;
  const pages = pagesStarted ? readiness.done / readiness.total : 0;
  // Never 100 % before the end: more pages may still be discovered.
  const percent = Math.min(99, Math.floor((LOCAL_SHARE * local + (1 - LOCAL_SHARE) * pages) * 100));
  const working = bootstrap.running || readiness.running;
  const incomplete = online && readiness.incomplete && !working;

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <IconCloudDownload className="size-6" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{t("preparation.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("preparation.description")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">
                {localDone ? t("preparation.stepPages") : t("preparation.stepLocal")}
              </span>
              <span className="tabular font-semibold">{t("preparation.percent", { percent })}</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t("preparation.title")}
              className="h-3 overflow-hidden rounded-full bg-primary/15"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            {online && !incomplete ? (
              <p className="text-xs text-muted-foreground">{t("preparation.keepOnline")}</p>
            ) : null}
          </div>

          {!online ? (
            <Alert>
              <IconCloudOff className="size-4" />
              <AlertTitle>{t("preparation.offlineTitle")}</AlertTitle>
              <AlertDescription>{t("preparation.offline")}</AlertDescription>
            </Alert>
          ) : incomplete ? (
            <Alert>
              <IconAlertTriangle className="size-4" />
              <AlertDescription>{t("preparation.incomplete")}</AlertDescription>
            </Alert>
          ) : null}

          {!online || incomplete ? (
            <div className="space-y-2">
              {incomplete ? (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void synchronize(companyId, { force: true })}
                >
                  {t("preparation.retry")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="w-full" onClick={onSkip}>
                {t("preparation.skip")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {t("preparation.skipHint")}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
