/**
 * Garde d'écran : une adresse appartenant à un module désactivé affiche une
 * explication simple et, pour qui en a le droit, le bouton pour l'activer — plutôt
 * qu'une page d'erreurs 403 incompréhensible.
 */

import type { ReactNode } from "react";
import { IconPuzzle } from "@tabler/icons-react";
import { Link, useLocation } from "wouter";

import { FEATURE_MODULES } from "@shared/modules-catalog";
import { useSession } from "@/shared/auth/session";
import { moduleForPath } from "@/shared/config/nav";
import { Button } from "@/shared/ui/button";

const BUSINESS_NAMES: Record<string, string> = {
  auto_parts: "Pièces auto",
  clothing: "Vêtements",
  market: "Alimentation",
};

function moduleName(code: string): string {
  return (
    FEATURE_MODULES.find((feature) => feature.code === code)?.name ?? BUSINESS_NAMES[code] ?? code
  );
}

export function ModuleGate({ children }: { children: ReactNode }) {
  const [pathname] = useLocation();
  const { hasModule, can } = useSession();
  const module = moduleForPath(pathname);

  if (!module || hasModule(module)) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <IconPuzzle className="size-7" />
        </div>
        <h1 className="text-xl font-semibold">« {moduleName(module)} » n'est pas activé</h1>
        <p className="text-sm text-muted-foreground">
          {can("modules.manage")
            ? "Activez ce module pour utiliser cet écran. Vos données ne sont jamais effacées."
            : "Demandez à l'administrateur d'activer ce module."}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/">Retour à l'accueil</Link>
          </Button>
          {can("modules.manage") ? (
            <Button asChild>
              <Link href="/settings/modules">Gérer les modules</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
