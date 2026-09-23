/**
 * Écran de connexion.
 *
 * Particularité terrain : si le poste est **hors ligne** et qu'une session a déjà été
 * ouverte sur cet appareil, on l'indique explicitement et on propose de reprendre le
 * travail hors connexion, plutôt que d'afficher un formulaire qui ne peut pas aboutir.
 */

import { useEffect, useState, type FormEvent } from "react";
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
  const { login, refresh } = useSession();
  const online = useOnline();
  const cached = getCachedSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [offlineLoginReady, setOfflineLoginReady] = useState(false);

  // Connexion à froid hors ligne : réservée à la coquille desktop, où les empreintes
  // des comptes autorisés vivent dans un SQLite applicatif ([NFR-SEC-5]).
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
      // Hors ligne sur un poste desktop déjà synchronisé : on vérifie l'empreinte
      // locale pour déverrouiller l'interface, sans jeton d'API.
      if (!online && offlineLoginReady) {
        const accepted = await verifyOfflineLogin(username.trim(), password);
        if (accepted) {
          await refresh();
          return;
        }
        setError("Identifiants incorrects (vérification hors ligne).");
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
            <h1 className="text-xl font-semibold tracking-tight">ERP Sahel</h1>
            <p className="text-sm text-muted-foreground">
              Gestion commerciale, stock, caisse et comptabilité
            </p>
          </div>
        </div>

        {!online ? (
          <Alert>
            <IconCloudOff className="size-4" />
            <AlertTitle>Serveur injoignable</AlertTitle>
            <AlertDescription>
              {cached
                ? "Une session existe sur ce poste. Reconnectez-vous dès le retour du réseau ; vos ventes enregistrées localement seront alors synchronisées."
                : offlineLoginReady
                  ? "Ce poste est synchronisé : saisissez vos identifiants habituels pour travailler hors ligne."
                  : "Une première connexion au serveur est nécessaire avant de pouvoir travailler hors ligne sur ce poste."}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Connexion</CardTitle>
            <CardDescription>Saisissez vos identifiants pour accéder à l'ERP.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Identifiant</Label>
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
                <Label htmlFor="password">Mot de passe</Label>
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
                {submitting ? "Connexion…" : "Se connecter"}
              </Button>

              {cached && !online ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void refresh()}
                >
                  Reprendre la session hors ligne
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Les ventes réalisées hors ligne sont conservées sur ce poste et synchronisées
          automatiquement au retour du réseau.
        </p>
      </div>
    </div>
  );
}
