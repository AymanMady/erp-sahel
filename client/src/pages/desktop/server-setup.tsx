/**
 * First launch of the desktop application: which server does this workstation use?
 *
 * Shown instead of the whole application — nothing else can work before this answer.
 */

import { useTranslation } from "react-i18next";

import { ServerAddressForm } from "@/features/desktop/server-address-form";
import { LanguageSwitcher } from "@/shared/components/language-switcher";
import { brandIcon as BrandIcon } from "@/shared/config/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

export default function ServerSetupPage() {
  const { t } = useTranslation("device");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BrandIcon className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("common:appName")}</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("setup.title")}</CardTitle>
            <CardDescription>{t("setup.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerAddressForm submitLabel={t("setup.submit")} />
          </CardContent>
        </Card>
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
