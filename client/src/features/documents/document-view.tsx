/**
 * Rendu en lecture d'un document commercial (devis, commande, facture, avoir).
 *
 * Conçu pour l'écran **et pour l'impression** : la feuille porte la classe
 * `print-sheet`, et la coquille applicative disparaît à l'impression (voir `erp.css`).
 * Un client attend une facture imprimable, pas une capture d'écran.
 */

import type { ReactNode } from "react";

import { formatDate } from "@shared/format";
import { computeDocumentTotals } from "@shared/pricing";
import { useSession } from "@/shared/auth/session";
import { Money, Quantity, Rate } from "@/shared/components/money";
import { Separator } from "@/shared/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export interface DocumentViewLine {
  id: string;
  productSku?: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  discountBp: number;
  vatRateBp: number;
  totalHtCents: number;
  originCountry?: string;
}

export function DocumentView({
  title,
  number,
  date,
  dueDate,
  partyName,
  partyDetails,
  lines,
  totalHtCents,
  totalVatCents,
  totalTtcCents,
  paidAmountCents,
  notes,
  badge,
  footerNote,
}: {
  title: string;
  number: string;
  date: string;
  dueDate?: string | null;
  partyName: string;
  partyDetails?: ReactNode;
  lines: DocumentViewLine[];
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  paidAmountCents?: number;
  notes?: string;
  badge?: ReactNode;
  footerNote?: ReactNode;
}) {
  const { company } = useSession();
  const vatBreakdown = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      vatRateBp: line.vatRateBp,
    })),
    { vatEnabled: company?.vatEnabled ?? true }
  ).vatBreakdown;

  // Le pays d'origine n'est affiché que s'il est renseigné — exigence du module
  // Auto Parts, sans intérêt pour un vêtement ([FR-VNT-5]).
  const showOrigin = lines.some((line) => line.originCountry);

  return (
    <div className="print-sheet rounded-lg border bg-card p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {company?.logo ? (
            <img src={company.logo} alt="" className="size-12 rounded-md object-contain" />
          ) : null}
          <div>
            <p className="text-lg font-semibold">{company?.name}</p>
            <p className="text-xs text-muted-foreground">Devise : {company?.currency}</p>
          </div>
        </div>
        <div className="text-end">
          <div className="flex items-center justify-end gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {badge}
          </div>
          <p className="tabular text-sm font-medium">{number}</p>
          <p className="text-xs text-muted-foreground">Date : {formatDate(date)}</p>
          {dueDate ? (
            <p className="text-xs text-muted-foreground">Échéance : {formatDate(dueDate)}</p>
          ) : null}
        </div>
      </header>

      <Separator className="my-6" />

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Destinataire</p>
        <p className="text-sm font-medium">{partyName}</p>
        {partyDetails}
      </section>

      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Désignation</TableHead>
              {showOrigin ? <TableHead>Origine</TableHead> : null}
              <TableHead className="text-end">Qté</TableHead>
              <TableHead className="text-end">P.U. HT</TableHead>
              <TableHead className="text-end">Remise</TableHead>
              <TableHead className="text-end">TVA</TableHead>
              <TableHead className="text-end">Total HT</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <p className="font-medium">{line.description}</p>
                  {line.productSku ? (
                    <p className="tabular text-xs text-muted-foreground">{line.productSku}</p>
                  ) : null}
                </TableCell>
                {showOrigin ? (
                  <TableCell className="text-sm">{line.originCountry || "—"}</TableCell>
                ) : null}
                <TableCell className="text-end">
                  <Quantity value={line.quantity} /> {line.unit}
                </TableCell>
                <TableCell className="text-end">
                  <Money cents={line.unitPriceCents} withSymbol={false} />
                </TableCell>
                <TableCell className="text-end">
                  {line.discountBp ? <Rate bp={line.discountBp} /> : "—"}
                </TableCell>
                <TableCell className="text-end">
                  <Rate bp={line.vatRateBp} />
                </TableCell>
                <TableCell className="text-end font-medium">
                  <Money cents={line.totalHtCents} withSymbol={false} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total HT</span>
            <Money cents={totalHtCents} />
          </div>
          {vatBreakdown
            .filter((entry) => entry.vatCents !== 0)
            .map((entry) => (
              <div key={entry.vatRateBp} className="flex items-center justify-between">
                <span className="text-muted-foreground">TVA {entry.vatRateBp / 100} %</span>
                <Money cents={entry.vatCents} />
              </div>
            ))}
          {vatBreakdown.length === 0 || totalVatCents === 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">TVA</span>
              <Money cents={totalVatCents} />
            </div>
          ) : null}
          <Separator className="my-2" />
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total TTC</span>
            <Money cents={totalTtcCents} />
          </div>
          {paidAmountCents !== undefined ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Déjà réglé</span>
                <Money cents={paidAmountCents} />
              </div>
              <div className="flex items-center justify-between font-medium">
                <span>Reste à payer</span>
                <Money cents={Math.max(0, totalTtcCents - paidAmountCents)} />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {notes ? (
        <>
          <Separator className="my-6" />
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap text-sm">{notes}</p>
          </div>
        </>
      ) : null}

      {footerNote ? <p className="mt-6 text-xs text-muted-foreground">{footerNote}</p> : null}
    </div>
  );
}
