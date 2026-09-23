/**
 * Référentiel véhicule à quatre niveaux : marque → modèle → génération → motorisation
 * ([FR-VEH-1] à [FR-VEH-4]).
 *
 * Présenté en colonnes liées plutôt qu'en arbre : au comptoir, on descend la hiérarchie
 * en trois clics, ce qui est le geste réel lorsqu'un client décrit son véhicule.
 */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FUEL_TYPES } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { autoPartsApi } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

type DialogKind = "brand" | "model" | "generation" | "engine" | null;

export default function VehiclesPage() {
  const { can } = useSession();
  const [brandId, setBrandId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.autoParts.vehicles,
    queryFn: () => autoPartsApi.vehicleTree(),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const brands = data?.brands ?? [];
  const models = (data?.models ?? []).filter((model) => model.brandId === brandId);
  const generations = (data?.generations ?? []).filter(
    (generation) => generation.modelId === modelId
  );
  const engines = (data?.engines ?? []).filter((engine) => engine.generationId === generationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Référentiel véhicules"
        description="Une pièce peut être compatible au niveau du modèle, de la génération ou de la motorisation."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Column
          title="Marques"
          items={brands.map((brand) => ({ id: brand.id, label: brand.name }))}
          selectedId={brandId}
          onSelect={(id) => {
            setBrandId(id);
            setModelId(null);
            setGenerationId(null);
          }}
          onAdd={can("auto_parts.write") ? () => setDialog("brand") : undefined}
        />
        <Column
          title="Modèles"
          items={models.map((model) => ({ id: model.id, label: model.name }))}
          selectedId={modelId}
          onSelect={(id) => {
            setModelId(id);
            setGenerationId(null);
          }}
          onAdd={can("auto_parts.write") && brandId ? () => setDialog("model") : undefined}
          disabled={!brandId}
          emptyHint="Choisissez une marque."
        />
        <Column
          title="Générations"
          items={generations.map((generation) => ({
            id: generation.id,
            label: `${generation.name} (${generation.yearStart}–${generation.yearEnd ?? "…"})`,
          }))}
          selectedId={generationId}
          onSelect={setGenerationId}
          onAdd={can("auto_parts.write") && modelId ? () => setDialog("generation") : undefined}
          disabled={!modelId}
          emptyHint="Choisissez un modèle."
        />
        <Column
          title="Motorisations"
          items={engines.map((engine) => ({
            id: engine.id,
            label: engine.label ? `${engine.code} — ${engine.label}` : engine.code,
          }))}
          selectedId={null}
          onSelect={() => undefined}
          onAdd={can("auto_parts.write") && generationId ? () => setDialog("engine") : undefined}
          disabled={!generationId}
          emptyHint="Choisissez une génération."
        />
      </div>

      <VehicleDialog
        kind={dialog}
        onClose={() => setDialog(null)}
        brandId={brandId}
        modelId={modelId}
        generationId={generationId}
      />
    </div>
  );
}

function Column({
  title,
  items,
  selectedId,
  onSelect,
  onAdd,
  disabled,
  emptyHint,
}: {
  title: string;
  items: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  return (
    <Card className={cn(disabled && "opacity-60")}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {onAdd ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Ajouter — ${title}`}
            onClick={onAdd}
          >
            <IconPlus className="size-4" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-2">
        <ScrollArea className="h-72">
          <div className="space-y-0.5">
            {items.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                {disabled ? emptyHint : "Aucun élément."}
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted",
                    selectedId === item.id && "bg-primary/10 font-medium text-primary"
                  )}
                >
                  {item.label}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function VehicleDialog({
  kind,
  onClose,
  brandId,
  modelId,
  generationId,
}: {
  kind: DialogKind;
  onClose: () => void;
  brandId: string | null;
  modelId: string | null;
  generationId: string | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [yearStart, setYearStart] = useState(new Date().getFullYear() - 5);
  const [yearEnd, setYearEnd] = useState<number | "">("");
  const [fuel, setFuel] = useState<(typeof FUEL_TYPES)[number]>("DIESEL");
  const [label, setLabel] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      if (kind === "brand") return autoPartsApi.createBrand({ name });
      if (kind === "model") return autoPartsApi.createModel({ brandId, name });
      if (kind === "generation") {
        return autoPartsApi.createGeneration({
          modelId,
          name,
          yearStart,
          yearEnd: yearEnd === "" ? null : yearEnd,
        });
      }
      return autoPartsApi.createEngine({ generationId, code: name, label, fuel });
    },
    onSuccess: () => {
      toast.success("Enregistré.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.autoParts.vehicles });
      setName("");
      setLabel("");
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const titles: Record<Exclude<DialogKind, null>, string> = {
    brand: "Nouvelle marque",
    model: "Nouveau modèle",
    generation: "Nouvelle génération",
    engine: "Nouvelle motorisation",
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind ? titles[kind] : ""}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={kind === "engine" ? "Code moteur" : "Nom"} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
              placeholder={kind === "engine" ? "2GD-FTV" : undefined}
              className={kind === "engine" ? "tabular" : undefined}
            />
          </Field>

          {kind === "generation" ? (
            <FieldGrid>
              <Field label="Année de début" required>
                <Input
                  type="number"
                  className="tabular"
                  value={yearStart}
                  onChange={(event) => setYearStart(Number(event.target.value))}
                  required
                />
              </Field>
              <Field label="Année de fin" hint="Vide si encore produite">
                <Input
                  type="number"
                  className="tabular"
                  value={yearEnd}
                  onChange={(event) =>
                    setYearEnd(event.target.value === "" ? "" : Number(event.target.value))
                  }
                />
              </Field>
            </FieldGrid>
          ) : null}

          {kind === "engine" ? (
            <FieldGrid>
              <Field label="Libellé">
                <Input value={label} onChange={(event) => setLabel(event.target.value)} />
              </Field>
              <Field label="Carburant">
                <Select
                  value={fuel}
                  onValueChange={(value) => setFuel(value as (typeof FUEL_TYPES)[number])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry.charAt(0) + entry.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGrid>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
