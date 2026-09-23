/** Profil de l'utilisateur connecté : identité, permissions et mot de passe. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { PERMISSIONS, type PermissionCode } from "@shared/rbac";
import { initials } from "@shared/format";
import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

export default function ProfilePage() {
  const { user, company, permissions, modules, logout } = useSession();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => settingsApi.changePassword(form),
    onSuccess: async () => {
      toast.success("Mot de passe modifié. Reconnectez-vous.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      // Le serveur révoque toutes les sessions : on referme proprement la nôtre.
      await logout();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Mon profil" description="Informations du compte et sécurité." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarFallback className="text-lg">{initials(fullName)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-semibold">{fullName}</p>
                <p className="tabular text-sm text-muted-foreground">{user?.username}</p>
                <p className="text-sm text-muted-foreground">{company?.name}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Modules actifs</p>
              <div className="flex flex-wrap gap-1">
                {modules.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Aucun module activé.</span>
                ) : (
                  modules.map((module) => (
                    <Badge key={module} variant="outline">
                      {module}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Permissions ({permissions.length})</p>
              <div className="flex flex-wrap gap-1">
                {permissions.map((permission) => (
                  <Badge key={permission} variant="secondary" className="text-[10px]">
                    {PERMISSIONS[permission as PermissionCode] ?? permission}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>
              Le changer déconnecte toutes vos sessions, y compris sur les autres postes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
            >
              <Field label="Mot de passe actuel" required error={errors.currentPassword}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
                  required
                />
              </Field>
              <Field
                label="Nouveau mot de passe"
                required
                error={errors.newPassword}
                hint="8 caractères minimum, au moins une lettre et un chiffre."
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
                  required
                />
              </Field>
              <Field label="Confirmation" required error={errors.confirmPassword}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                  required
                />
              </Field>
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                Modifier le mot de passe
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
