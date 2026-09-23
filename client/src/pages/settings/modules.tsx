/**
 * Activation des modules métier ([FR-PLAT-3], [FR-PLUG-7]).
 *
 * Activer ou désactiver un module change immédiatement la navigation, les formulaires
 * produit et les endpoints accessibles — sans redéploiement.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCar, IconPuzzle, IconShirt, IconShoppingBag } from "@tabler/icons-react";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/components/page-header";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

const MODULE_ICONS: Record<string, typeof IconCar> = {
  auto_parts: IconCar,
  clothing: IconShirt,
  market: IconShoppingBag,
};

export default function ModulesSettingsPage() {
  const queryClient = useQueryClient();
  const { can, refresh } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => settingsApi.listModules(),
  });

  const toggle = useMutation({
    mutationFn: ({ code, enable }: { code: string; enable: boolean }) =>
      enable ? settingsApi.enableModule(code) : settingsApi.disableModule(code),
    onSuccess: async (_result, variables) => {
      toast.success(variables.enable ? "Module activé." : "Module désactivé.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.modules });
      // La session porte la liste des modules : sans rafraîchissement, la navigation
      // resterait dans son état précédent.
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modules métier"
        description={`Noyau ERP version ${data?.coreVersion ?? "—"}. Chaque module est autonome et activable par société.`}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data?.modules ?? []).map((module) => {
          const Icon = MODULE_ICONS[module.code] ?? IconPuzzle;
          return (
            <Card key={module.code}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{module.name}</CardTitle>
                      <p className="tabular text-xs text-muted-foreground">v{module.version}</p>
                    </div>
                  </div>
                  <Switch
                    checked={module.isEnabled}
                    disabled={!can("modules.manage") || toggle.isPending}
                    onCheckedChange={(checked) =>
                      toggle.mutate({ code: module.code, enable: checked })
                    }
                    aria-label={`Activer ${module.name}`}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>{module.description}</CardDescription>
                <div className="flex flex-wrap gap-1">
                  {module.searchCriteria.map((criterion) => (
                    <Badge key={criterion.key} variant="outline" className="text-[10px]">
                      {criterion.label}
                    </Badge>
                  ))}
                </div>
                {module.dependencies.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Dépend de : {module.dependencies.join(", ")}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
