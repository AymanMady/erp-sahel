/** Point d'entrée du client. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "@/app/providers/app-providers";
import { AppRouter } from "@/app/router/app-router";
import { registerServiceWorker } from "@/shared/offline/register-sw";
import { requestPersistentStorage } from "@/shared/offline/db";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Élément racine introuvable dans index.html.");

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>
);

// Coquille hors-ligne et persistance du stockage : demandées au démarrage, sans
// bloquer le rendu. Un échec dégrade le mode hors ligne, il n'empêche pas l'usage.
void registerServiceWorker();
void requestPersistentStorage();
