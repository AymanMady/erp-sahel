/** Point d'entrée du client. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "@/app/providers/app-providers";
import { AppRouter } from "@/app/router/app-router";
import { queryClient } from "@/shared/api/query-client";
import { persistQueryCache, restoreQueryCache } from "@/shared/offline/query-persistence";
import { registerServiceWorker } from "@/shared/offline/register-sw";
import { requestPersistentStorage } from "@/shared/offline/db";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Élément racine introuvable dans index.html.");

// Le cache persisté est rechargé avant le premier rendu : sinon les premières
// requêtes partiraient (et échoueraient hors ligne) avant que les données locales
// ne soient disponibles. Un délai plafonne l'attente si IndexedDB est lent.
const root = container;
void Promise.race([
  restoreQueryCache(queryClient),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(() => {
  persistQueryCache(queryClient);
  createRoot(root).render(
    <StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </StrictMode>
  );
});

// Coquille hors-ligne et persistance du stockage : demandées au démarrage, sans
// bloquer le rendu. Un échec dégrade le mode hors ligne, il n'empêche pas l'usage.
void registerServiceWorker();
void requestPersistentStorage();
