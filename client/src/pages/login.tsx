/**
 * Login screen.
 *
 * Field specificity: if the device is **offline** and a session has already been opened
 * on it, this is stated explicitly and the user is offered to resume working offline,
 * rather than showing a form that cannot succeed.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { IconAlertTriangle, IconCloudOff, IconLock, IconUser } from "@tabler/icons-react";

import { errorMessage } from "@/shared/api/api-error";
import { useSession } from "@/shared/auth/session";
import { getCachedSession } from "@/shared/auth/token-store";
import { isTauriDesktop } from "@/shared/desktop/desktop";
import { canLoginOffline, verifyOfflineLogin } from "@/shared/offline/storage";
import { useOnline } from "@/shared/hooks/use-online";
import { brandIcon as BrandIcon } from "@/shared/config/nav";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export default function LoginPage() {
  const { t } = useTranslation("auth");
  const { login, refresh } = useSession();
  const online = useOnline();
  const cached = getCachedSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [offlineLoginReady, setOfflineLoginReady] = useState(false);

  // Cold offline login: reserved for the desktop shell, where the hashes of the
  // authorized accounts live in an application SQLite database ([NFR-SEC-5]).
  useEffect(() => {
    if (!isTauriDesktop()) return;
    void canLoginOffline().then(setOfflineLoginReady);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
    } catch (submitError) {
      // Offline on an already synchronized desktop device: check the local hash to
      // unlock the interface, without an API token.
      if (!online && offlineLoginReady) {
        const accepted = await verifyOfflineLogin(username.trim(), password);
        if (accepted) {
          await refresh();
          return;
        }
        setError(t("login.offlineInvalidCredentials"));
        return;
      }
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BrandIcon className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("common:appName")}</h1>
            <p className="text-sm text-muted-foreground">{t("login.tagline")}</p>
          </div>
        </div>

        {!online ? (
          <Alert>
            <IconCloudOff className="size-4" />
            <AlertTitle>{t("login.offline.title")}</AlertTitle>
            <AlertDescription>
              {cached
                ? t("login.offline.sessionExists")
                : offlineLoginReady
                  ? t("login.offline.deviceSynced")
                  : t("login.offline.firstLoginRequired")}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("login.title")}</CardTitle>
            <CardDescription>{t("login.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t("login.username")}</Label>
                <div className="relative">
                  <IconUser className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    className="ps-9"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("login.password")}</Label>
                <div className="relative">
                  <IconLock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    className="ps-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <IconAlertTriangle className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t("login.submitting") : t("login.submit")}
              </Button>

              {cached && !online ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void refresh()}
                >
                  {t("login.resumeOffline")}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">{t("login.offlineFootnote")}</p>
      </div>
    </div>
  );
}
