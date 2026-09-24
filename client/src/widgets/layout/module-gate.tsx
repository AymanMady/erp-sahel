/**
 * Screen guard: a path belonging to a disabled module shows a simple explanation
 * and, for users allowed to, the button to enable it — rather than a page of
 * incomprehensible 403 errors.
 */

import type { ReactNode } from "react";
import { IconPuzzle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { moduleForPath } from "@/shared/config/nav";
import { moduleName } from "@/shared/lib/i18n-labels";
import { Button } from "@/shared/ui/button";

export function ModuleGate({ children }: { children: ReactNode }) {
  const [pathname] = useLocation();
  const { hasModule, can } = useSession();
  const module = moduleForPath(pathname);
  const { t } = useTranslation("layout");

  if (!module || hasModule(module)) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <IconPuzzle className="size-7" />
        </div>
        <h1 className="text-xl font-semibold">
          {t("moduleGate.title", { module: moduleName(module) })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {can("modules.manage") ? t("moduleGate.canEnable") : t("moduleGate.askAdmin")}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/">{t("moduleGate.backHome")}</Link>
          </Button>
          {can("modules.manage") ? (
            <Button asChild>
              <Link href="/settings/modules">{t("moduleGate.manageModules")}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
