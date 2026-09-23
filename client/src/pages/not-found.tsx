/** Page inconnue. */

import { IconArrowLeft } from "@tabler/icons-react";
import { Link } from "wouter";

import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md">
        <CardContent className="space-y-4 py-10 text-center">
          <p className="tabular text-5xl font-semibold text-muted-foreground">404</p>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Page introuvable</h1>
            <p className="text-sm text-muted-foreground">
              Cette adresse ne correspond à aucun écran de l'ERP. Elle a peut-être été déplacée, ou
              le module correspondant n'est pas activé pour votre société.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <IconArrowLeft className="size-4" />
              Retour au tableau de bord
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
