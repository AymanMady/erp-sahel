/** État des séquences de numérotation légale par type de document et exercice. */

import { useQuery } from "@tanstack/react-query";

import { settingsApi } from "@/entities/settings/api";
import { errorMessage } from "@/shared/api/api-error";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Card, CardContent } from "@/shared/ui/card";

const DOCUMENT_LABELS: Record<string, string> = {
  QUOTE: "Devis",
  SALES_ORDER: "Commandes de vente",
  SALES_INVOICE: "Factures clients",
  CREDIT_NOTE: "Avoirs",
  PURCHASE_ORDER: "Commandes fournisseurs",
  GOODS_RECEIPT: "Bons de réception",
  SUPPLIER_INVOICE: "Factures fournisseurs",
  PAYMENT: "Règlements",
  JOURNAL_ENTRY: "Écritures comptables",
  INVENTORY_COUNT: "Inventaires",
  POS_TICKET: "Tickets de caisse",
  PARTY: "Tiers",
};

interface SequenceRow {
  documentType: string;
  year: number;
  lastNumber: number;
  prefix: string;
}

export default function NumberingSettingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["company-sequences"],
    queryFn: () => settingsApi.listSequences(),
  });

  const columns: Column<SequenceRow>[] = [
    {
      id: "type",
      header: "Type de document",
      cell: (row) => (
        <span className="font-medium">{DOCUMENT_LABELS[row.documentType] ?? row.documentType}</span>
      ),
    },
    { id: "year", header: "Exercice", cell: (row) => <span className="tabular">{row.year}</span> },
    {
      id: "prefix",
      header: "Préfixe",
      cell: (row) => <span className="tabular">{row.prefix}</span>,
    },
    {
      id: "last",
      header: "Dernier numéro",
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
      <PageHeader
        title="Numérotation"
        description="Séquences légales par type de document et par exercice."
      />

      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Les numéros sont attribués par le serveur au moment de la validation, dans la transaction
          du document : deux postes ne peuvent pas obtenir le même. Hors ligne, un numéro provisoire{" "}
          <span className="tabular">OFFLINE-…</span> est affiché jusqu'à la synchronisation.
        </CardContent>
      </Card>

      <ResourceTable
        columns={columns}
        rows={(data ?? []) as SequenceRow[]}
        rowKey={(row) => `${row.documentType}-${row.year}`}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune séquence"
        emptyDescription="Les séquences se créent à l'émission du premier document de chaque type."
      />
    </div>
  );
}
