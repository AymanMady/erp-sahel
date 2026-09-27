/**
 * Server address of this workstation: typed, checked (it must answer as this
 * application's server), then saved. Used at first launch and to move to another server.
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { IconAlertTriangle, IconWorld } from "@tabler/icons-react";

import {
  ServerAddressError,
  UnsentDataError,
  checkServer,
  currentServerUrl,
  normalizeServerUrl,
  saveServerUrl,
} from "@/shared/desktop/device-config";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export function ServerAddressForm({
  submitLabel,
  onCancel,
}: {
  submitLabel: string;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("device");
  const [address, setAddress] = useState(() => currentServerUrl() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const origin = normalizeServerUrl(address);
      await checkServer(origin);
      await saveServerUrl(origin);
      // Every screen, session and cache starts again from the new server, at home.
      window.location.replace("/");
    } catch (saveError) {
      if (saveError instanceof ServerAddressError) setError(t(`errors.${saveError.reason}`));
      else if (saveError instanceof UnsentDataError)
        setError(t("errors.unsent", { count: saveError.count }));
      else setError(t("errors.saveFailed", { detail: String((saveError as Error).message) }));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="server-address">{t("setup.label")}</Label>
        <div className="relative">
          <IconWorld className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="server-address"
            dir="ltr"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            className="ps-9"
            placeholder={t("setup.placeholder")}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
            autoFocus
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("setup.hint")}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <IconAlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            {t("common:actions.cancel")}
          </Button>
        ) : null}
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? t("setup.checking") : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Moves the workstation to another server; what it kept for the old one is erased. */
export function ChangeServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("device");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("change.title")}</DialogTitle>
          <DialogDescription>{t("change.description")}</DialogDescription>
        </DialogHeader>
        <ServerAddressForm submitLabel={t("change.submit")} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
