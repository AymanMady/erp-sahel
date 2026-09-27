/**
 * Download of the desktop application: pick a system, get its installer.
 *
 * The installers are those of the release this server offers its workstations (the
 * same one the updater installs), so a new computer starts at the others' release.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconBrandApple,
  IconBrandUbuntu,
  IconBrandWindows,
  IconCheck,
  IconCopy,
  IconDownload,
  type Icon,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/shared/api/http";
import { errorMessage } from "@/shared/api/api-error";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/utils";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

type SystemCode = "windows" | "linux" | "macos";

interface Installer {
  system: SystemCode;
  arch: string;
  format: string;
  url: string;
}

const SYSTEMS: { code: SystemCode; icon: Icon }[] = [
  { code: "windows", icon: IconBrandWindows },
  { code: "linux", icon: IconBrandUbuntu },
  { code: "macos", icon: IconBrandApple },
];

/** Most useful file first: the one most people should take. */
const FORMAT_ORDER = ["exe", "msi", "deb", "appimage", "rpm", "dmg"];

/** System of the computer looking at the page, to preselect it. */
function detectSystem(): SystemCode {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac/i.test(agent) && !/iPhone|iPad/i.test(agent)) return "macos";
  if (/Linux/i.test(agent) && !/Android/i.test(agent)) return "linux";
  return "windows";
}

export default function DesktopAppPage() {
  const { t } = useTranslation("settings");
  const [system, setSystem] = useState<SystemCode>(detectSystem);

  const { data, isLoading, error } = useQuery({
    queryKey: ["desktop-downloads"],
    queryFn: () =>
      api.get<{ version: string | null; installers: Installer[] }>("/api/desktop/downloads"),
  });

  const installers = (data?.installers ?? [])
    .filter((installer) => installer.system === system)
    .sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format));

  return (
    <div className="space-y-6">
      <PageHeader title={t("desktopApp.title")} description={t("desktopApp.description")} />

      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">
        {SYSTEMS.map(({ code, icon: SystemIcon }) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={system === code}
            onClick={() => setSystem(code)}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card p-4 text-start transition-colors hover:bg-accent",
              system === code && "border-primary ring-2 ring-primary/30"
            )}
          >
            <SystemIcon className="size-8 shrink-0" />
            <span className="flex-1 font-medium">{t(`desktopApp.systems.${code}`)}</span>
            {system === code ? <IconCheck className="size-5 text-primary" /> : null}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {t("desktopApp.download", { system: t(`desktopApp.systems.${system}`) })}
            </CardTitle>
            {data?.version ? (
              <CardDescription>
                {t("desktopApp.version", { version: data.version })}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <Skeleton className="h-10 w-full" /> : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}
            {data && !data.version ? (
              <p className="text-sm text-muted-foreground">{t("desktopApp.noRelease")}</p>
            ) : null}
            {data?.version && installers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("desktopApp.notForSystem")}</p>
            ) : null}
            {installers.map((installer, index) => (
              <div
                key={installer.url}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`desktopApp.formats.${installer.format}`)}
                    {installer.arch === "aarch64" ? ` ${t("desktopApp.arm")}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    .{installer.format === "appimage" ? "AppImage" : installer.format}
                  </p>
                </div>
                <Button asChild variant={index === 0 ? "default" : "outline"}>
                  <a href={installer.url} download>
                    <IconDownload className="size-4" />
                    {t("desktopApp.downloadButton")}
                  </a>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <StepsCard system={system} />
      </div>
    </div>
  );
}

function StepsCard({ system }: { system: SystemCode }) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  const serverAddress = window.location.origin;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("desktopApp.copyFailed"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("desktopApp.steps.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-3 ps-5 text-sm">
          <li>{t("desktopApp.steps.download")}</li>
          <li>{t(`desktopApp.steps.open.${system}`)}</li>
          <li className="space-y-2">
            <p>{t("desktopApp.steps.server")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2" dir="ltr">
                {serverAddress}
              </code>
              <Button variant="outline" size="icon" onClick={() => void copy()}>
                {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
                <span className="sr-only">{t("desktopApp.copy")}</span>
              </Button>
            </div>
          </li>
          <li>{t("desktopApp.steps.signIn")}</li>
        </ol>
      </CardContent>
    </Card>
  );
}
