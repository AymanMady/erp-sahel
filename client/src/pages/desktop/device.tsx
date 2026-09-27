/**
 * "This device" — settings of the desktop workstation, not of the company:
 * installed release and updates, server address, ticket printer.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconDownload, IconPrinter, IconRefresh } from "@tabler/icons-react";

import { ChangeServerDialog } from "@/features/desktop/server-address-form";
import { printTicket, testTicketRows } from "@/features/printing/ticket";
import { errorMessage } from "@/shared/api/api-error";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import {
  currentServerUrl,
  printerSettings,
  savePrinterSettings,
  type PrinterSettings,
} from "@/shared/desktop/device-config";
import { APP_VERSION } from "@/shared/desktop/desktop";
import { checkForUpdate, installUpdate, useAppUpdate } from "@/shared/desktop/updater";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";

export default function DevicePage() {
  const { t } = useTranslation("device");
  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ApplicationCard />
          <ServerCard />
        </div>
        <PrinterCard />
      </div>
    </div>
  );
}

function ApplicationCard() {
  const { t } = useTranslation("device");
  const update = useAppUpdate();
  const busy = update.status === "checking" || update.status === "installing";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("app.title")}</CardTitle>
        <CardDescription>{t("app.keptData")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("app.version")}</span>
          <span className="font-medium" dir="ltr">
            {APP_VERSION}
          </span>
        </div>

        {update.status === "upToDate" ? (
          <p className="text-sm text-status-success">{t("app.upToDate")}</p>
        ) : null}
        {update.status === "available" || update.status === "installing" ? (
          <Alert>
            <IconDownload className="size-4" />
            <AlertDescription>
              <p className="font-medium text-foreground">
                {t("app.available", { version: update.info?.version ?? "" })}
              </p>
              {update.info?.notes ? (
                <p className="whitespace-pre-line">{update.info.notes}</p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {update.status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{update.info ? t("app.installFailed") : t("app.checkFailed")}</p>
              {update.error ? (
                <p className="text-xs" dir="ltr">
                  {update.error}
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void checkForUpdate()}>
            <IconRefresh className="size-4" />
            {update.status === "checking" ? t("app.checking") : t("app.check")}
          </Button>
          {update.status === "available" || update.status === "installing" ? (
            <Button disabled={busy} onClick={() => void installUpdate()}>
              <IconDownload className="size-4" />
              {update.status === "installing" ? t("app.installing") : t("app.install")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ServerCard() {
  const { t } = useTranslation("device");
  const [changing, setChanging] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("server.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("server.address")}</span>
          <span className="truncate font-medium" dir="ltr">
            {currentServerUrl() ?? "—"}
          </span>
        </div>
        <Button variant="outline" onClick={() => setChanging(true)}>
          {t("change.button")}
        </Button>
      </CardContent>
      <ChangeServerDialog open={changing} onOpenChange={setChanging} />
    </Card>
  );
}

function PrinterCard() {
  const { t } = useTranslation("device");
  const [settings, setSettings] = useState<PrinterSettings>(() => printerSettings());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const direct = settings.mode === "direct";
  const patch = (value: Partial<PrinterSettings>) =>
    setSettings((current) => ({ ...current, ...value }));

  const save = async () => {
    setSaving(true);
    try {
      await savePrinterSettings(settings);
      toast.success(t("printer.saved"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      // The settings on screen, even before they are saved: try, then keep.
      await printTicket(testTicketRows(), settings);
      if (direct) toast.success(t("printer.testSent"));
    } catch (error) {
      toast.error(t("printer.failed", { detail: errorMessage(error) }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("printer.title")}</CardTitle>
        <CardDescription>{t("printer.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field label={t("printer.mode")}>
          <Select
            value={settings.mode}
            onValueChange={(value) => patch({ mode: value === "direct" ? "direct" : "system" })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("printer.modes.system")}</SelectItem>
              <SelectItem value="direct">{t("printer.modes.direct")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {direct ? (
          <Field
            label={t("printer.target")}
            htmlFor="printer-target"
            hint={t("printer.targetHint")}
          >
            <Input
              id="printer-target"
              dir="ltr"
              spellCheck={false}
              placeholder="tcp://192.168.1.50:9100"
              value={settings.target}
              onChange={(event) => patch({ target: event.target.value })}
            />
          </Field>
        ) : null}

        <Field label={t("printer.paperWidth")}>
          <Select
            value={String(settings.paperWidth)}
            onValueChange={(value) => patch({ paperWidth: value === "58" ? 58 : 80 })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="80">{t("printer.paper80")}</SelectItem>
              <SelectItem value="58">{t("printer.paper58")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="printer-auto">{t("printer.autoPrint")}</Label>
          <Switch
            id="printer-auto"
            checked={settings.autoPrint}
            onCheckedChange={(checked) => patch({ autoPrint: checked })}
          />
        </div>

        {direct ? (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="printer-drawer">{t("printer.openDrawer")}</Label>
            <Switch
              id="printer-drawer"
              checked={settings.openDrawer}
              onCheckedChange={(checked) => patch({ openDrawer: checked })}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={saving || (direct && !settings.target.trim())}
            onClick={() => void save()}
          >
            {t("printer.save")}
          </Button>
          <Button
            variant="outline"
            disabled={testing || (direct && !settings.target.trim())}
            onClick={() => void test()}
          >
            <IconPrinter className="size-4" />
            {t("printer.test")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
