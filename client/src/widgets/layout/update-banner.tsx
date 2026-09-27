/**
 * Application update banner, at the top of every screen.
 *
 *  - **Required** (the server refused this release): always shown, in red. The till
 *    keeps working on its local copy; sales wait on the workstation until the update.
 *  - **Available**: a quiet line with an install button, that can be put off until the
 *    next start.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react";

import { useUpgradeRequirement } from "@/shared/api/upgrade";
import {
  canSelfUpdate,
  checkForUpdate,
  installUpdate,
  useAppUpdate,
} from "@/shared/desktop/updater";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

export function UpdateBanner({ className }: { className?: string }) {
  const { t } = useTranslation("device");
  const requirement = useUpgradeRequirement();
  const update = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);
  const installing = update.status === "installing";

  const install = async () => {
    // The release to install must come from a fresh check.
    const checked = update.status === "available" ? update : await checkForUpdate();
    if (checked.status === "available") await installUpdate();
  };

  if (requirement) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-destructive px-4 py-2 text-center text-sm text-white print-hidden",
          className
        )}
      >
        <IconAlertTriangle className="size-4 shrink-0" />
        <span>
          <strong>{t("banner.requiredTitle")}</strong> — {t("banner.required")}
        </span>
        {canSelfUpdate() ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={installing}
            onClick={() => void install()}
          >
            <IconDownload className="size-4" />
            {installing ? t("app.installing") : t("banner.install")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            {t("banner.reload")}
          </Button>
        )}
        {update.status === "error" ? (
          <span className="w-full text-xs opacity-90">{t("app.installFailed")}</span>
        ) : null}
      </div>
    );
  }

  if (dismissed || (update.status !== "available" && !installing)) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-1.5 text-center text-xs font-medium text-primary-foreground print-hidden",
        className
      )}
    >
      <IconDownload className="size-3.5 shrink-0" />
      <span>{t("banner.available", { version: update.info?.version ?? "" })}</span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7"
        disabled={installing}
        onClick={() => void install()}
      >
        {installing ? t("app.installing") : t("banner.install")}
      </Button>
      {!installing ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          onClick={() => setDismissed(true)}
        >
          {t("banner.later")}
        </Button>
      ) : null}
    </div>
  );
}
