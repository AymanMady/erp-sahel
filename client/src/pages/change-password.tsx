/**
 * Required password change.
 *
 * Shown instead of the application when an administrator created the account or reset
 * its password: the person chooses a password only they know. The server then ends
 * every session, so we sign in again straight away with the new password.
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import { useSession } from "@/shared/auth/session";
import { clearSession } from "@/shared/auth/token-store";
import { Field } from "@/shared/components/field";
import { useOnline } from "@/shared/hooks/use-online";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

export default function ChangePasswordPage() {
  const { t } = useTranslation("profile");
  const { user, login, logout, refresh } = useSession();
  const online = useOnline();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      await settingsApi.changePassword(form);
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
      setSubmitting(false);
      return;
    }
    try {
      await login({ username: user?.username ?? "", password: form.newPassword });
    } catch {
      // Password changed but the new sign-in failed: send the person to the sign-in
      // screen, without deleting what is waiting to be sent from this device.
      clearSession();
      await refresh();
      toast.info(t("forced.signInAgain"));
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("forced.title")}</CardTitle>
          <CardDescription>{t("forced.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field
              label={t("forced.current")}
              htmlFor="forced-current"
              required
              error={errors.currentPassword}
            >
              <Input
                id="forced-current"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
                required
              />
            </Field>
            <Field
              label={t("password.new")}
              htmlFor="forced-new"
              required
              error={errors.newPassword}
              hint={t("password.hint")}
            >
              <Input
                id="forced-new"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
                required
              />
            </Field>
            <Field
              label={t("password.confirm")}
              htmlFor="forced-confirm"
              required
              error={errors.confirmPassword}
            >
              <Input
                id="forced-confirm"
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                required
              />
            </Field>
            {!online && <p className="text-sm text-destructive">{t("forced.offline")}</p>}
            <Button type="submit" className="w-full" disabled={submitting || !online}>
              {t("forced.submit")}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
              {t("layout:userMenu.signOut")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
