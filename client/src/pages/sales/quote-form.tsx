/** Création d'un devis. */

import { useState } from "react";
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import { addDays, todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { salesApi } from "@/entities/sales/api";
import { onlineOrQueued, queueQuoteCreate } from "@/shared/offline/offline-writes";
import type { Party } from "@/entities/types";
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
import { Textarea } from "@/shared/ui/textarea";

export default function QuoteFormPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { company } = useSession();

  const [party, setParty] = useState<Party | null>(null);
  const [date, setDate] = useState(todayInput());
  const [expiryDate, setExpiryDate] = useState(addDays(todayInput(), 30));
  const [notes, setNotes] = useState("");
  const [globalDiscountBp, setGlobalDiscountBp] = useState(0);
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine(company?.defaultVatRateBp ?? 0)]);

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        partyId: party?.id as string,
        date,
        expiryDate: expiryDate || null,
        notes,
        globalDiscountBp,
        lines: toApiLines(lines),
      };
      return onlineOrQueued(
        () => salesApi.createQuote(input),
        () => queueQuoteCreate(input)
      );
    },
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: ["quotes"] });
      if (outcome.mode === "offline") {
        // Pas encore d'identifiant serveur : la fiche n'existe qu'après synchronisation.
        toast.success(`Devis ${outcome.result.provisionalNumber} enregistré hors ligne.`, {
          description: "Il recevra son numéro définitif à la prochaine synchronisation.",
        });
        navigate("/sync");
        return;
      }
      toast.success(`Devis ${outcome.result.number} créé.`);
      navigate(`/quotes/${outcome.result.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const canSubmit = Boolean(party) && toApiLines(lines).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouveau devis"
        description="Proposition commerciale, sans effet sur le stock."
      >
        <Button variant="outline" asChild>
          <Link href="/quotes">
            <IconArrowLeft className="size-4" />
            Retour
          </Link>
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          <IconDeviceFloppy className="size-4" />
          {mutation.isPending ? "Création…" : "Créer le devis"}
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>En-tête</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGrid columns={3}>
            <Field label="Client" required>
              <PartyPicker value={party} onChange={setParty} role="CUSTOMER" />
            </Field>
            <Field label="Date du devis">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Valable jusqu'au">
              <Input
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
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
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Conditions particulières, délais, mentions…"
            />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}
