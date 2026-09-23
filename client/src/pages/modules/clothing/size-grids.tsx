/** Grilles de tailles du module Vêtements et génération des déclinaisons. */

import { useState } from "react";
import { IconPlus, IconTrash, IconWand } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { clothingApi, type SizeGrid } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export default function SizeGridsPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.clothing.sizeGrids,
    queryFn: () => clothingApi.listSizeGrids(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => clothingApi.deleteSizeGrid(id),
    onSuccess: () => {
      toast.success("Grille supprimée.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.clothing.sizeGrids });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<SizeGrid>[] = [
    {
      id: "name",
      header: "Grille",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "sizes",
      header: "Tailles",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.sizes.map((size) => (
            <Badge key={size} variant="outline" className="tabular">
              {size}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("clothing.write") ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Supprimer"
            onClick={() => remove.mutate(row.id)}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grilles de tailles"
        description="Les déclinaisons taille × couleur deviennent des variantes du catalogue."
      >
        {can("clothing.write") ? (
          <>
            <Button variant="outline" onClick={() => setGenerateOpen(true)}>
              <IconWand className="size-4" />
              Générer des déclinaisons
            </Button>
            <Button onClick={() => setOpen(true)}>
              <IconPlus className="size-4" />
              Nouvelle grille
            </Button>
          </>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune grille"
        emptyDescription="Des grilles usuelles sont créées à l'activation du module."
      />

      <GridDialog open={open} onOpenChange={setOpen} />
      <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} grids={data ?? []} />
    </div>
  );
}

function GridDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [sizes, setSizes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      clothingApi.createSizeGrid({
        name,
        sizes: sizes
          .split(",")
          .map((size) => size.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success("Grille créée.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.clothing.sizeGrids });
      onOpenChange(false);
      setName("");
      setSizes("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle grille de tailles</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Nom" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field
            label="Tailles"
            hint="Séparées par des virgules, dans l'ordre d'affichage."
            required
          >
            <Input
              value={sizes}
              onChange={(event) => setSizes(event.target.value)}
              placeholder="XS, S, M, L, XL"
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim() || !sizes.trim()}>
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GenerateDialog({
  open,
  onOpenChange,
  grids,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grids: SizeGrid[];
}) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [gridId, setGridId] = useState("");
  const [colors, setColors] = useState("");

  const { data: products } = useQuery({
    queryKey: queryKeys.products({ clothing: true }),
    queryFn: () => catalogApi.listProducts({ profileType: "CLOTHING", limit: 50 }),
    enabled: open,
  });

  const selectedGrid = grids.find((grid) => grid.id === gridId);
  const colorList = colors
    .split(",")
    .map((color) => color.trim())
    .filter(Boolean);
  const variantCount = (selectedGrid?.sizes.length ?? 0) * colorList.length;

  const mutation = useMutation({
    mutationFn: () =>
      clothingApi.generateVariants({
        productId,
        sizes: selectedGrid?.sizes ?? [],
        colors: colorList,
      }),
    onSuccess: (result) => {
      toast.success(`${result.created} déclinaison(s) générée(s).`);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Générer les déclinaisons</DialogTitle>
          <DialogDescription>
            Chaque combinaison taille × couleur devient une variante avec sa propre référence, son
            code-barres et son stock.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Produit" required>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un article vêtement" />
              </SelectTrigger>
              <SelectContent>
                {(products?.items ?? []).map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.sku} — {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Grille de tailles" required>
            <Select value={gridId} onValueChange={setGridId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {grids.map((grid) => (
                  <SelectItem key={grid.id} value={grid.id}>
                    {grid.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Couleurs" hint="Séparées par des virgules." required>
            <Input
              value={colors}
              onChange={(event) => setColors(event.target.value)}
              placeholder="Noir, Blanc, Bleu marine"
            />
          </Field>
          {variantCount > 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              <strong className="tabular">{variantCount}</strong> déclinaison(s) seront créées. Les
              variantes existantes de ce produit seront remplacées.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !productId || !gridId || colorList.length === 0}
          >
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
