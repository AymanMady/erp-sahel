/**
 * Création d'une facture client.
 *
 * Deux gestes distincts, volontairement séparés : **enregistrer un brouillon** (aucun
 * effet) et **valider** (numéro légal, décrément de stock, écriture comptable, document
 * verrouillé). Rendre les deux identiques ferait valider des factures par accident.
 */

import { useState } from "react";
import { IconArrowLeft, IconCheck, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import { addDays, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import { invoicingApi } from "@/entities/invoicing/api";
import type { Party } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import {
  LineEditor,
  emptyLine,
  toApiLines,
  type DocumentLine,
} from "@/features/documents/line-editor";
import { PartyPicker } from "@/features/documents/party-picker";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const DEFAULT_WAREHOUSE = "DEFAULT";

export default function InvoiceFormPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { company } = useSession();

  const [party, setParty] = useState<Party | null>(null);
  const [date, setDate] = useState(todayInput());
  const [dueDate, setDueDate] = useState("");
  const [warehouseId, setWarehouseId] = useState(DEFAULT_WAREHOUSE);
  const [notes, setNotes] = useState("");
  const [globalDiscountBp, setGlobalDiscountBp] = useState(0);
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine(company?.defaultVatRateBp ?? 0)]);

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const submit = useMutation({
    mutationFn: (validate: boolean) =>
      invoicingApi.create({
        partyId: party?.id,
        date,
        dueDate: dueDate || null,
        warehouseId: warehouseId === DEFAULT_WAREHOUSE ? null : warehouseId,
        notes,
        globalDiscountBp,
        lines: toApiLines(lines),
        validate,
      }),
    onSuccess: (invoice) => {
      toast.success(
        invoice.status === "DRAFT"
          ? "Brouillon de facture enregistré."
          : `Facture ${invoice.number} validée : stock et comptabilité mis à jour.`
      );
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const canSubmit = Boolean(party) && toApiLines(lines).length > 0;

  // Échéance déduite des conditions de règlement du client dès qu'il est choisi.
  const applyParty = (next: Party | null) => {
    setParty(next);
    if (next && next.paymentTermsDays > 0) setDueDate(addDays(date, next.paymentTermsDays));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle facture"
        description="Un brouillon n'a aucun effet ; la validation décrémente le stock et comptabilise."
      >
        <Button variant="outline" asChild>
          <Link href="/invoices">
            <IconArrowLeft className="size-4" />
            Retour
          </Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => submit.mutate(false)}
          disabled={!canSubmit || submit.isPending}
        >
          <IconDeviceFloppy className="size-4" />
          Enregistrer le brouillon
        </Button>
        <Button onClick={() => submit.mutate(true)} disabled={!canSubmit || submit.isPending}>
          <IconCheck className="size-4" />
          {submit.isPending ? "Traitement…" : "Valider la facture"}
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>En-tête</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGrid columns={3}>
            <Field label="Client" required>
              <PartyPicker value={party} onChange={applyParty} role="CUSTOMER" />
            </Field>
            <Field label="Date de facture">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Échéance">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
            <Field label="Magasin de livraison" hint="Détermine d'où le stock est sorti.">
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_WAREHOUSE}>Magasin par défaut</SelectItem>
                  {(warehouses ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lignes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LineEditor
            lines={lines}
            onChange={setLines}
            globalDiscountBp={globalDiscountBp}
            onGlobalDiscountChange={setGlobalDiscountBp}
          />
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}
