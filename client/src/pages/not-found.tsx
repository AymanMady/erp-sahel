/** Unknown page. */

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

export default function NotFoundPage() {
  const { t } = useTranslation("notFound");
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md">
        <CardContent className="space-y-4 py-10 text-center">
          <p className="tabular text-5xl font-semibold text-muted-foreground">404</p>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <IconArrowLeft className="size-4 rtl:rotate-180" />
              {t("backToDashboard")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
