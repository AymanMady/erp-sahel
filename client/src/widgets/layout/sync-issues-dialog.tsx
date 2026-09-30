/**
 * What the offline-first desktop could not send as it was, and needs a person's
 * decision (`offline/local/sync-issues.ts`):
 *  - a change that met another change of the same sensitive field (a price, a credit
 *    limit) — both versions side by side, the person keeps one;
 *  - an operation the server refused — try again, or give it up.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { Money } from "@/shared/components/money";
import type { ConflictRow } from "@/shared/offline/local/local-db";
import {
  discardOperation,
  listSyncIssues,
  resolveConflict,
  retryOperation,
} from "@/shared/offline/local/sync-issues";
import { refreshCounters, runSync } from "@/shared/offline/sync-engine";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

const ISSUES_KEY = ["sync-issues"] as const;

/** A field value as the person knows it: money in MRU, a list by its size. */
function FieldValue({ field, value }: { field: string; value: unknown }) {
  if (field.endsWith("Cents") && typeof value === "number") return <Money cents={value} />;
  if (Array.isArray(value)) return <span className="tabular">{value.length}</span>;
  return <span>{value == null || value === "" ? "—" : String(value)}</span>;
}

function ConflictCard({ conflict, onDone }: { conflict: ConflictRow; onDone: () => void }) {
  const { t } = useTranslation("offline");
  const mine =
    ((conflict.localPayload ?? {}) as { changes?: Record<string, unknown> }).changes ?? {};
  const server = conflict.serverData ?? {};
  const name = String(server.name ?? server.code ?? "");
  const resolve = useMutation({
    mutationFn: (choice: "keep_local" | "keep_server") => resolveConflict(conflict, choice),
    onSuccess: () => {
      toast.success(t("issues.done"));
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <div>
        <p className="font-medium">
          {t(`local.${conflict.entity}`)} — {name}
        </p>
        <p className="text-xs text-muted-foreground">{t("issues.conflictHint")}</p>
      </div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-start font-normal" />
            <th className="text-end font-normal">{t("issues.mine")}</th>
            <th className="text-end font-normal">{t("issues.server")}</th>
          </tr>
        </thead>
        <tbody>
          {conflict.fields.map((field) => (
            <tr key={field}>
              <td>{t(`issues.fields.${field}`, { defaultValue: field })}</td>
              <td className="text-end font-medium">
                <FieldValue field={field} value={mine[field]} />
              </td>
              <td className="text-end">
                <FieldValue field={field} value={server[field]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.isPending}
          onClick={() => resolve.mutate("keep_server")}
        >
          {t("issues.keepServer")}
        </Button>
        <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate("keep_local")}>
          {t("issues.keepMine")}
        </Button>
      </div>
    </div>
  );
}

export function SyncIssuesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("offline");
  const queryClient = useQueryClient();
  const [confirmDialog, confirm] = useConfirm();
  const { data } = useQuery({
    queryKey: ISSUES_KEY,
    queryFn: listSyncIssues,
    enabled: open,
    staleTime: 0,
  });

  const settled = () => {
    void queryClient.invalidateQueries({ queryKey: ISSUES_KEY });
    // The kept version is on screen at once; a change to send again goes now.
    void queryClient.invalidateQueries();
    void refreshCounters().then(() => runSync({ force: true }));
  };

  const act = useMutation({
    mutationFn: async (input: { id: string; action: "retry" | "discard" }) => {
      if (input.action === "retry") await retryOperation(input.id);
      else await discardOperation(input.id);
    },
    onSuccess: settled,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const conflicts = data?.conflicts ?? [];
  const refused = data?.refused ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("issues.title")}</DialogTitle>
          <DialogDescription>{t("issues.description")}</DialogDescription>
        </DialogHeader>

        {conflicts.length === 0 && refused.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("issues.empty")}</p>
        ) : null}

        {conflicts.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("issues.conflictsTitle")}</h3>
            {conflicts.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} onDone={settled} />
            ))}
          </section>
        ) : null}

        {refused.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("issues.refusedTitle")}</h3>
            {refused.map((operation) => (
              <div key={operation.id} className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">{operation.label || operation.entity}</p>
                {operation.lastError ? (
                  <p className="text-xs text-status-danger">{operation.lastError}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.isPending}
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: t("issues.discardConfirm"),
                        confirmLabel: t("issues.discard"),
                        destructive: true,
                      });
                      if (confirmed) act.mutate({ id: operation.id, action: "discard" });
                    }}
                  >
                    {t("issues.discard")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: operation.id, action: "retry" })}
                  >
                    {t("issues.retry")}
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
