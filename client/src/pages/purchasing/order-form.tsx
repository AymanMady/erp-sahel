/** Création d'une commande fournisseur. */

import { useState } from "react";
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import { todayInput } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import { purchasingApi } from "@/entities/purchasing/api";
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

export default function PurchaseOrderFormPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { company } = useSession();

  const [supplier, setSupplier] = useState<Party | null>(null);
  const [date, setDate] = useState(todayInput());
  const [expectedDate, setExpectedDate] = useState("");
  const [warehouseId, setWarehouseId] = useState(DEFAULT_WAREHOUSE);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine(company?.defaultVatRateBp ?? 0)]);

  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      purchasingApi.createOrder({
        supplierId: supplier?.id,
        date,
        expectedDate: expectedDate || null,
        warehouseId: warehouseId === DEFAULT_WAREHOUSE ? null : warehouseId,
        notes,
        lines: toApiLines(lines),
      }),
    onSuccess: (order) => {
      toast.success(`Commande ${order.number} créée.`);
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate(`/purchase-orders/${order.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const canSubmit = Boolean(supplier) && toApiLines(lines).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle commande fournisseur"
        description="La commande n'affecte pas le stock : c'est la réception qui le fait."
      >
        <Button variant="outline" asChild>
          <Link href="/purchase-orders">
            <IconArrowLeft className="size-4" />
            Retour
          </Link>
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          <IconDeviceFloppy className="size-4" />
          {mutation.isPending ? "Création…" : "Créer la commande"}
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>En-tête</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGrid columns={3}>
            <Field label="Fournisseur" required>
              <PartyPicker
                value={supplier}
                onChange={(party) => {
                  setSupplier(party);
                  if (party && party.defaultLeadTimeDays > 0) {
                    const target = new Date(`${date}T00:00:00`);
                    target.setDate(target.getDate() + party.defaultLeadTimeDays);
                    setExpectedDate(target.toISOString().slice(0, 10));
                  }
                }}
                role="SUPPLIER"
                placeholder="Sélectionner un fournisseur"
              />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Livraison prévue">
              <Input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </Field>
            <Field label="Magasin de réception">
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
          <LineEditor lines={lines} onChange={setLines} usePurchasePrice />
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}
