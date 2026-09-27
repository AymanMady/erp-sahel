/**
 * Safety screen shown when a page crashes while drawing, instead of a blank screen.
 *
 * Two cases:
 *  - a page that could not be downloaded (usually after an update: the old page files
 *    no longer exist on the server) — reloading fetches the new version;
 *  - any other display error — reloading usually fixes it, and nothing saved is lost.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconRefresh } from "@tabler/icons-react";

import { i18n } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

/** True for the errors thrown when a lazily loaded page file cannot be downloaded. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk/i.test(
      error.message
    )
  );
}

interface Props {
  children: ReactNode;
  /** Takes the whole screen (outermost boundary) instead of the page area only. */
  fullScreen?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Display error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Class component: the i18n instance is read directly (no hook available).
    const t = i18n.getFixedT(null, "layout");
    const newVersion = isChunkLoadError(error);
    return (
      <div
        role="alert"
        className={
          this.props.fullScreen
            ? "flex min-h-dvh items-center justify-center bg-background p-4"
            : "flex min-h-[60vh] items-center justify-center"
        }
      >
        <Card className="max-w-md">
          <CardContent className="space-y-4 py-10 text-center">
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">
                {newVersion ? t("crash.newVersionTitle") : t("crash.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {newVersion ? t("crash.newVersionDescription") : t("crash.description")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => window.location.reload()}>
                <IconRefresh className="size-4" />
                {t("crash.reload")}
              </Button>
              {!newVersion && (
                <Button variant="outline" onClick={() => window.location.assign("/")}>
                  {t("crash.home")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}
