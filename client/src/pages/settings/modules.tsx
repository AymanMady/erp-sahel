/**
 * Modules de la société ([FR-PLAT-3]).
 *
 * Deux étapes :
 *  1. **un niveau** (simple, avec factures, complet) — un clic active le bon lot ;
 *  2. **les modules un par un** (caisse, achats, stock…) — à ajuster au besoin.
 *
 * Tout changement s'applique immédiatement au menu, aux écrans et à l'API.
 * Désactiver un module ne supprime aucune donnée.
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
import { toast } from "sonner";

import { MODULE_PRESETS, moduleName, type ModulePreset } from "@shared/modules-catalog";
import { errorMessage } from "@/shared/api/api-error";
import { refreshSession } from "@/shared/api/http";
import { settingsApi } from "@/entities/settings/api";
import type { ModuleDescriptor } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/components/page-header";
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
  const canManage = can("modules.manage");
  const [pendingPreset, setPendingPreset] = useState<ModulePreset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => settingsApi.listModules(),
  });

  const afterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    // Le jeton d'accès porte les modules actifs : sans le réémettre, le serveur
    // refuserait les écrans fraîchement activés jusqu'à son expiration.
    await refreshSession();
    // La session porte aussi la liste des modules : le menu suit immédiatement.
    await refresh();
  };

  const toggle = useMutation({
    mutationFn: ({ code, enable }: { code: string; enable: boolean }) =>
      enable ? settingsApi.enableModule(code) : settingsApi.disableModule(code),
    onSuccess: async (_result, variables) => {
      toast.success(variables.enable ? "Module activé." : "Module désactivé.");
      await afterChange();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const applyPreset = useMutation({
    mutationFn: (preset: ModulePreset) => settingsApi.applyModuleSelection({ preset: preset.code }),
    onSuccess: async (_result, preset) => {
      toast.success(`Niveau « ${preset.name} » appliqué.`);
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
          <span className="block font-medium">{module.name}</span>
          <span className="block text-sm text-muted-foreground">{module.description}</span>
          {module.dependencies.length > 0 ? (
            <span className="block text-xs text-muted-foreground">
              Nécessite : {module.dependencies.map(moduleName).join(", ")}
            </span>
          ) : null}
        </span>
        <Switch
          checked={module.isEnabled}
          disabled={!canManage || busy}
          onCheckedChange={(checked) => toggle.mutate({ code: module.code, enable: checked })}
          aria-label={`Activer ${module.name}`}
        />
      </label>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Modules"
        description="Activez seulement ce que vous utilisez : le menu reste simple. Désactiver un module n'efface jamais vos données."
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">1. Choisissez un niveau</h2>
          <p className="text-sm text-muted-foreground">
            Pour tout type de commerce. Vous pourrez ajuster ensuite.
          </p>
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
                  "relative flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors",
                  "hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60",
                  active && "border-primary bg-primary/5"
                )}
              >
                {active ? (
                  <IconCheck className="absolute top-3 right-3 size-4 text-primary" />
                ) : null}
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="font-medium">{preset.name}</span>
                <span className="text-xs text-muted-foreground">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">2. Ou ajustez module par module</h2>
          <p className="text-sm text-muted-foreground">
            Produits, clients, paiements et réglages sont toujours disponibles.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{modules.map(renderModule)}</div>
      </section>

      <AlertDialog
        open={pendingPreset !== null}
        onOpenChange={(open) => !open && setPendingPreset(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Passer au niveau « {pendingPreset?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Modules activés : {pendingPreset?.modules.map(moduleName).join(", ")}. Les autres
              seront masqués, sans perte de données.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={applyPreset.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingPreset) applyPreset.mutate(pendingPreset);
              }}
            >
              Appliquer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
