/**
 * Company modules ([FR-PLAT-3]).
 *
 * Two steps:
 *  1. **a level** (simple, with invoices, full) — one click enables the right set;
 *  2. **modules one by one** (POS, purchasing, stock…) — to fine-tune as needed.
 *
 * Every change applies immediately to the menu, the screens and the API.
 * Disabling a module never deletes any data.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconApps,
  IconBuildingBank,
  IconBuildingStore,
  IconCalculator,
  IconCashRegister,
  IconChartBar,
  IconCheck,
  IconClipboardList,
  IconFileInvoice,
  IconPackages,
  IconPuzzle,
  IconTool,
  IconTruckDelivery,
  type Icon,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MODULE_PRESETS, type ModulePreset } from "@shared/modules-catalog";
import { errorMessage } from "@/shared/api/api-error";
import { refreshSession } from "@/shared/api/http";
import { settingsApi } from "@/entities/settings/api";
import type { ModuleDescriptor } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/components/page-header";
import {
  moduleDescription,
  moduleName,
  presetDescription,
  presetName,
} from "@/shared/lib/i18n-labels";
import { cn } from "@/shared/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

const ICONS: Record<string, Icon> = {
  IconApps,
  IconBuildingBank,
  IconBuildingStore,
  IconCalculator,
  IconCashRegister,
  IconChartBar,
  IconClipboardList,
  IconFileInvoice,
  IconPackages,
  IconTool,
  IconTruckDelivery,
};

function iconOf(name: string): Icon {
  return ICONS[name] ?? IconPuzzle;
}

export default function ModulesSettingsPage() {
  const queryClient = useQueryClient();
  const { can, refresh } = useSession();
  const { t } = useTranslation("settings");
  const canManage = can("modules.manage");
  const [pendingPreset, setPendingPreset] = useState<ModulePreset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => settingsApi.listModules(),
  });

  const afterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    // The access token carries the enabled modules: without re-issuing it, the server
    // would reject freshly enabled screens until it expires.
    await refreshSession();
    // The session also carries the module list: the menu follows immediately.
    await refresh();
  };

  const toggle = useMutation({
    mutationFn: ({ code, enable }: { code: string; enable: boolean }) =>
      enable ? settingsApi.enableModule(code) : settingsApi.disableModule(code),
    onSuccess: async (_result, variables) => {
      toast.success(variables.enable ? t("modules.enabled") : t("modules.disabled"));
      await afterChange();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const applyPreset = useMutation({
    mutationFn: (preset: ModulePreset) => settingsApi.applyModuleSelection({ preset: preset.code }),
    onSuccess: async (_result, preset) => {
      toast.success(t("modules.presetApplied", { name: presetName(preset.code) }));
      setPendingPreset(null);
      await afterChange();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const modules = data?.modules ?? [];
  const enabledCodes = new Set(modules.filter((m) => m.isEnabled).map((m) => m.code));
  const matchesPreset = (preset: ModulePreset) =>
    preset.modules.length === enabledCodes.size &&
    preset.modules.every((code) => enabledCodes.has(code));
  const busy = toggle.isPending || applyPreset.isPending;

  const renderModule = (module: ModuleDescriptor) => {
    const Icon = iconOf(module.icon);
    return (
      <label
        key={module.code}
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 shadow-xs",
          !module.isEnabled && "opacity-70"
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-medium">{moduleName(module.code)}</span>
          <span className="block text-sm text-muted-foreground">
            {moduleDescription(module.code, module.description)}
          </span>
          {module.dependencies.length > 0 ? (
            <span className="block text-xs text-muted-foreground">
              {t("modules.requires", {
                modules: module.dependencies.map((code) => moduleName(code)).join(", "),
              })}
            </span>
          ) : null}
        </span>
        <Switch
          checked={module.isEnabled}
          disabled={!canManage || busy}
          onCheckedChange={(checked) => toggle.mutate({ code: module.code, enable: checked })}
          aria-label={t("modules.enableAria", { name: moduleName(module.code) })}
        />
      </label>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader title={t("modules.title")} description={t("modules.description")} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t("modules.step1Title")}</h2>
          <p className="text-sm text-muted-foreground">{t("modules.step1Description")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODULE_PRESETS.map((preset) => {
            const Icon = iconOf(preset.icon);
            const active = matchesPreset(preset);
            return (
              <button
                key={preset.code}
                type="button"
                disabled={!canManage || busy}
                onClick={() => setPendingPreset(preset)}
                className={cn(
                  "relative flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-start shadow-xs transition-colors",
                  "hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60",
                  active && "border-primary bg-primary/5"
                )}
              >
                {active ? <IconCheck className="absolute end-3 top-3 size-4 text-primary" /> : null}
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="font-medium">{presetName(preset.code)}</span>
                <span className="text-xs text-muted-foreground">
                  {presetDescription(preset.code)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t("modules.step2Title")}</h2>
          <p className="text-sm text-muted-foreground">{t("modules.step2Description")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{modules.map(renderModule)}</div>
      </section>

      <AlertDialog
        open={pendingPreset !== null}
        onOpenChange={(open) => !open && setPendingPreset(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("modules.confirmTitle", {
                name: pendingPreset ? presetName(pendingPreset.code) : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("modules.confirmDescription", {
                modules: (pendingPreset?.modules ?? []).map((code) => moduleName(code)).join(", "),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={applyPreset.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingPreset) applyPreset.mutate(pendingPreset);
              }}
            >
              {t("common:actions.apply")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
