/**
 * Modules de la société ([FR-PLAT-3], [FR-PLUG-7]).
 *
 * Trois étapes, dans l'ordre où un commerçant les pense :
 *  1. **son activité** (boutique, pièces auto, vêtements…) — un clic active le bon lot ;
 *  2. **les fonctionnalités** (caisse, achats, stock…) — à ajuster au besoin ;
 *  3. **les métiers** (pièces auto, vêtements, alimentation).
 *
 * Tout changement s'applique immédiatement au menu, aux écrans et à l'API, sans
 * redéploiement. Désactiver un module ne supprime aucune donnée.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconApps,
  IconBuildingBank,
  IconBuildingStore,
  IconCalculator,
  IconCar,
  IconCashRegister,
  IconChartBar,
  IconCheck,
  IconClipboardList,
  IconFileInvoice,
  IconPackages,
  IconPuzzle,
  IconShirt,
  IconShoppingBag,
  IconTool,
  IconTruck,
  IconTruckDelivery,
  type Icon,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { BUSINESS_PRESETS, type BusinessPreset } from "@shared/modules-catalog";
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
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

const ICONS: Record<string, Icon> = {
  IconApps,
  IconBuildingBank,
  IconBuildingStore,
  IconCalculator,
  IconCar,
  IconCashRegister,
  IconChartBar,
  IconClipboardList,
  IconFileInvoice,
  IconPackages,
  IconShirt,
  IconShoppingBag,
  IconTool,
  IconTruck,
  IconTruckDelivery,
};

/** Libellés courts des modules métier (le serveur garde leur nom technique complet). */
const BUSINESS_LABELS: Record<string, { name: string; description: string }> = {
  auto_parts: {
    name: "Pièces auto",
    description: "Références OEM, équivalences entre marques, véhicules compatibles.",
  },
  clothing: {
    name: "Vêtements",
    description: "Tailles et couleurs : chaque combinaison a son code-barres et son stock.",
  },
  market: {
    name: "Alimentation",
    description: "Lots, dates de péremption et alertes avant expiration.",
  },
};

function labelOf(module: ModuleDescriptor) {
  return BUSINESS_LABELS[module.code] ?? { name: module.name, description: module.description };
}

function iconOf(name: string): Icon {
  return ICONS[name] ?? IconPuzzle;
}

export default function ModulesSettingsPage() {
  const queryClient = useQueryClient();
  const { can, refresh } = useSession();
  const canManage = can("modules.manage");
  const [pendingPreset, setPendingPreset] = useState<BusinessPreset | null>(null);

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
    mutationFn: (preset: BusinessPreset) =>
      settingsApi.applyModuleSelection({ preset: preset.code }),
    onSuccess: async (_result, preset) => {
      toast.success(`Configuration « ${preset.name} » appliquée.`);
      setPendingPreset(null);
      await afterChange();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const modules = data?.modules ?? [];
  const features = modules.filter((module) => module.kind === "feature");
  const businesses = modules.filter((module) => module.kind === "business");
  const nameOf = (code: string) => {
    const module = modules.find((candidate) => candidate.code === code);
    return module ? labelOf(module).name : code;
  };
  const enabledCodes = new Set(modules.filter((m) => m.isEnabled).map((m) => m.code));
  const matchesPreset = (preset: BusinessPreset) =>
    preset.modules.length === enabledCodes.size &&
    preset.modules.every((code) => enabledCodes.has(code));
  const busy = toggle.isPending || applyPreset.isPending;

  const renderModule = (module: ModuleDescriptor) => {
    const { name, description } = labelOf(module);
    const Icon = iconOf(module.icon);
    return (
      <Card key={module.code} className={cn(!module.isEnabled && "opacity-70")}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base">{name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {module.isEnabled ? "Activé" : "Désactivé"}
                </p>
              </div>
            </div>
            <Switch
              checked={module.isEnabled}
              disabled={!canManage || busy}
              onCheckedChange={(checked) => toggle.mutate({ code: module.code, enable: checked })}
              aria-label={`Activer ${name}`}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <CardDescription>{description}</CardDescription>
          {module.searchCriteria.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {module.searchCriteria.map((criterion) => (
                <Badge key={criterion.key} variant="outline" className="text-[10px]">
                  {criterion.label}
                </Badge>
              ))}
            </div>
          ) : null}
          {module.dependencies.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Nécessite : {module.dependencies.map(nameOf).join(", ")}
            </p>
          ) : null}
        </CardContent>
      </Card>
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
          <h2 className="text-lg font-semibold">1. Votre activité</h2>
          <p className="text-sm text-muted-foreground">
            Choisissez votre type de commerce : les bons modules s'activent en un clic.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {BUSINESS_PRESETS.map((preset) => {
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
          <h2 className="text-lg font-semibold">2. Fonctionnalités</h2>
          <p className="text-sm text-muted-foreground">
            Ajoutez ou retirez une fonctionnalité à tout moment.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{features.map(renderModule)}</div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">3. Métiers</h2>
          <p className="text-sm text-muted-foreground">
            Outils propres à un type de marchandise. Vous pouvez en activer plusieurs.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {businesses.map(renderModule)}
        </div>
      </section>

      <AlertDialog
        open={pendingPreset !== null}
        onOpenChange={(open) => !open && setPendingPreset(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Configurer pour « {pendingPreset?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Modules activés : {pendingPreset?.modules.map(nameOf).join(", ")}. Les autres seront
              masqués, sans perte de données.
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
