/**
 * "Export" and "Import" buttons of a list (products, customers and suppliers…).
 *
 * The exported file is also the model for an import: same columns, same titles. An
 * import is all or nothing — when the file has problems, the server saves nothing and
 * lists them by row, and they are shown here so the file can be fixed in Excel.
 */

import { useState } from "react";
import {
  IconAlertTriangle,
  IconDownload,
  IconFileSpreadsheet,
  IconUpload,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { todayInput } from "@shared/format";
import type { ImportIssue, ImportResult } from "@/entities/types";
import { ApiError, errorMessage } from "@/shared/api/api-error";
import { saveFile } from "@/shared/lib/download";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function SpreadsheetActions({
  fileName,
  exportFile,
  importFile,
  canImport,
  onImported,
  importHint,
}: {
  /** Name of the downloaded file, without date or extension ("produits"). */
  fileName: string;
  exportFile: () => Promise<Blob>;
  importFile: (file: File) => Promise<ImportResult>;
  canImport: boolean;
  /** Called after a successful import, to reload the list. */
  onImported: () => void;
  /** What the import does not cover on this screen, in plain words. */
  importHint?: string;
}) {
  const { t } = useTranslation("components");
  const [importing, setImporting] = useState(false);

  const download = useMutation({
    mutationFn: exportFile,
    onSuccess: (file) => saveFile(file, `${fileName}-${todayInput()}.xlsx`),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
        <IconDownload className="size-4" />
        {download.isPending ? t("spreadsheet.exporting") : t("spreadsheet.export")}
      </Button>
      {canImport ? (
        <Button variant="outline" onClick={() => setImporting(true)}>
          <IconUpload className="size-4" />
          {t("spreadsheet.import")}
        </Button>
      ) : null}
      {canImport ? (
        <ImportDialog
          open={importing}
          onOpenChange={setImporting}
          importFile={importFile}
          onImported={onImported}
          onDownloadModel={() => download.mutate()}
          downloading={download.isPending}
          hint={importHint}
        />
      ) : null}
    </>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  importFile,
  onImported,
  onDownloadModel,
  downloading,
  hint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importFile: (file: File) => Promise<ImportResult>;
  onImported: () => void;
  onDownloadModel: () => void;
  downloading: boolean;
  hint?: string;
}) {
  const { t } = useTranslation("components");
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: (chosen: File) => importFile(chosen),
    onSuccess: (result) => {
      toast.success(t("spreadsheet.done"), {
        description: [
          t("spreadsheet.created", { count: result.created }),
          t("spreadsheet.updated", { count: result.updated }),
        ].join(" · "),
      });
      onImported();
      close(false);
    },
  });

  const close = (next: boolean) => {
    if (!next) {
      setFile(null);
      upload.reset();
    }
    onOpenChange(next);
  };

  const issues = fileIssues(upload.error);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("spreadsheet.title")}</DialogTitle>
          <DialogDescription>{t("spreadsheet.description")}</DialogDescription>
        </DialogHeader>

        <ol className="list-decimal space-y-2 ps-5 text-sm">
          <li>
            {t("spreadsheet.step1")}{" "}
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={onDownloadModel}
              disabled={downloading}
            >
              {t("spreadsheet.downloadModel")}
            </Button>
          </li>
          <li>{t("spreadsheet.step2")}</li>
          <li>{t("spreadsheet.step3")}</li>
        </ol>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}

        <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm transition-colors hover:bg-muted">
          <IconFileSpreadsheet className="size-5 shrink-0" />
          <span className="min-w-0 truncate">{file ? file.name : t("spreadsheet.choose")}</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              upload.reset();
              // Choosing the same file again (after fixing it) must fire `onChange` again.
              event.target.value = "";
            }}
          />
        </label>

        {upload.error ? (
          <Alert variant="destructive">
            <IconAlertTriangle className="size-4" />
            <AlertTitle>{errorMessage(upload.error)}</AlertTitle>
            {issues.length > 0 ? (
              <AlertDescription>
                <ul className="max-h-60 space-y-1 overflow-y-auto">
                  {issues.map((issue, index) => (
                    <li key={index}>
                      {issue.column
                        ? t("spreadsheet.issue", { ...issue })
                        : t("spreadsheet.issueNoColumn", { ...issue })}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            ) : null}
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button disabled={!file || upload.isPending} onClick={() => file && upload.mutate(file)}>
            {upload.isPending ? t("spreadsheet.importing") : t("spreadsheet.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rows the server refused, when the file had problems. */
function fileIssues(error: unknown): ImportIssue[] {
  if (!(error instanceof ApiError) || error.code !== "IMPORT_INVALID") return [];
  return Array.isArray(error.details) ? (error.details as ImportIssue[]) : [];
}
