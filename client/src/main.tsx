/** Client entry point. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Must run first: sets the language, the text direction and the formatters' locale.
import "@/shared/i18n";
import { AppProviders } from "@/app/providers/app-providers";
import { AppRouter } from "@/app/router/app-router";
import { registerServiceWorker } from "@/shared/offline/register-sw";
import { requestPersistentStorage } from "@/shared/offline/db";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found in index.html.");

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>
);

// Offline shell and persistent storage: requested at startup without blocking
// rendering. A failure degrades offline mode, it does not prevent using the app.
void registerServiceWorker();
void requestPersistentStorage();
