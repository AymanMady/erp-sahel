/** Profile of the signed-in user: identity, preferences, permissions and password. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { initials } from "@shared/format";
import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { moduleName, permissionLabel } from "@/shared/lib/i18n-labels";
import { LANGUAGES, changeLanguage, currentLanguage, isLanguageCode } from "@/shared/i18n";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export default function ProfilePage() {
  const { t } = useTranslation("profile");
  const { user, company, permissions, modules, logout } = useSession();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // `useTranslation` re-renders on language change, so this stays current.
  const language = currentLanguage();

  const mutation = useMutation({
    mutationFn: () => settingsApi.changePassword(form),
    onSuccess: async () => {
      toast.success(t("password.changed"));
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      // The server revokes every session: close ours cleanly.
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
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("identity.title")}</CardTitle>
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
              <p className="mb-2 text-sm font-medium">{t("identity.activeModules")}</p>
              <div className="flex flex-wrap gap-1">
                {modules.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{t("identity.noModules")}</span>
                ) : (
                  modules.map((module) => (
                    <Badge key={module} variant="outline">
                      {moduleName(module)}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">
                {t("identity.permissions", { count: permissions.length })}
              </p>
              <div className="flex flex-wrap gap-1">
                {permissions.map((permission) => (
                  <Badge key={permission} variant="secondary" className="text-[10px]">
                    {permissionLabel(permission)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("preferences.title")}</CardTitle>
              <CardDescription>{t("preferences.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Field label={t("preferences.language")} htmlFor="profile-language">
                <Select
                  value={language}
                  onValueChange={(value) => {
                    if (isLanguageCode(value)) void changeLanguage(value);
                  }}
                >
                  <SelectTrigger id="profile-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((option) => (
                      <SelectItem key={option.code} value={option.code} lang={option.code}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("password.title")}</CardTitle>
              <CardDescription>{t("password.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate();
                }}
              >
                <Field label={t("password.current")} required error={errors.currentPassword}>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={form.currentPassword}
                    onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
                    required
                  />
                </Field>
                <Field
                  label={t("password.new")}
                  required
                  error={errors.newPassword}
                  hint={t("password.hint")}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.newPassword}
                    onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
                    required
                  />
                </Field>
                <Field label={t("password.confirm")} required error={errors.confirmPassword}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                    required
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={mutation.isPending}>
                  {t("password.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
