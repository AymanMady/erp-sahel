/** Client entry point. */

import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

// Must run first: sets the language, the text direction and the formatters' locale.
import "@/shared/i18n";
import { AppProviders } from "@/app/providers/app-providers";
import { AppRouter } from "@/app/router/app-router";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { loadDeviceConfig, needsServerSetup } from "@/shared/desktop/device-config";
import { startUpdateChecks } from "@/shared/desktop/updater";
import { DirectionProvider } from "@/shared/i18n/direction-provider";
import { registerServiceWorker } from "@/shared/offline/register-sw";
import { requestPersistentStorage } from "@/shared/offline/db";
import "@/styles/globals.css";

const ServerSetupPage = lazy(() => import("@/pages/desktop/server-setup"));

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found in index.html.");
const root = createRoot(container);

async function start(): Promise<void> {
  // Desktop: which server this workstation talks to. Read before the first request.
  await loadDeviceConfig();

  if (needsServerSetup()) {
    // First launch: nothing can work before the server is known — not even the session.
    root.render(
      <StrictMode>
        <ErrorBoundary fullScreen>
          <DirectionProvider>
            <ThemeProvider>
              <Suspense fallback={null}>
                <ServerSetupPage />
              </Suspense>
            </ThemeProvider>
          </DirectionProvider>
        </ErrorBoundary>
      </StrictMode>
    );
    return;
  }

  root.render(
    <StrictMode>
      <ErrorBoundary fullScreen>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </ErrorBoundary>
    </StrictMode>
  );

  startUpdateChecks();
}

void start();

// Offline shell and persistent storage: requested at startup without blocking
// rendering. A failure degrades offline mode, it does not prevent using the app.
void registerServiceWorker();
void requestPersistentStorage();
