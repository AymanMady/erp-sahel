/** State of the legal numbering sequences per document type and fiscal year. */

import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";

import { settingsApi } from "@/entities/settings/api";
import { errorMessage } from "@/shared/api/api-error";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Card, CardContent } from "@/shared/ui/card";

interface SequenceRow {
  documentType: string;
  year: number;
  lastNumber: number;
  prefix: string;
}

export default function NumberingSettingsPage() {
  const { t, i18n } = useTranslation("settings");
  const documentLabel = (type: string) =>
    i18n.exists(`settings:numbering.documentTypes.${type}`)
      ? t(`numbering.documentTypes.${type}`)
      : type;
  const { data, isLoading, error } = useQuery({
    queryKey: ["company-sequences"],
    queryFn: () => settingsApi.listSequences(),
  });

  const columns: Column<SequenceRow>[] = [
    {
      id: "type",
      header: t("numbering.columns.documentType"),
      cell: (row) => <span className="font-medium">{documentLabel(row.documentType)}</span>,
    },
    {
      id: "year",
      header: t("numbering.columns.year"),
      cell: (row) => <span className="tabular">{row.year}</span>,
    },
    {
      id: "prefix",
      header: t("numbering.columns.prefix"),
      cell: (row) => <span className="tabular">{row.prefix}</span>,
    },
    {
      id: "last",
      header: t("numbering.columns.lastNumber"),
      align: "end",
      cell: (row) => (
        <span className="tabular">
          {row.prefix}-{row.year}-{String(row.lastNumber).padStart(4, "0")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("numbering.title")} description={t("numbering.description")} />

      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          <Trans
            t={t}
            i18nKey="numbering.info"
            values={{ code: "OFFLINE-…" }}
            components={{ code: <span className="tabular" /> }}
          />
        </CardContent>
      </Card>

      <ResourceTable
        columns={columns}
        rows={(data ?? []) as SequenceRow[]}
        rowKey={(row) => `${row.documentType}-${row.year}`}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("numbering.emptyTitle")}
        emptyDescription={t("numbering.emptyDescription")}
      />
    </div>
  );
}
