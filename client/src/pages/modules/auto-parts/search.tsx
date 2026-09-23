/**
 * Recherche par référence OEM avec **équivalences** ([FR-SRCH-2], [FR-SRCH-3]).
 *
 * C'est la fonction la plus distinctive du module : saisir n'importe quelle référence
 * de la classe d'équivalence remonte tous les articles compatibles, quel que soit le
 * point d'entrée, avec fabricant, origine, qualité, prix et stock ([BR-2], [BR-5]).
 *
 * La recherche fonctionne **aussi hors ligne** : la fermeture transitive est alors
 * calculée sur l'instantané local, avec la même fonction partagée que le serveur.
 */

import { useMemo, useState } from "react";
import { IconCloudOff, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { normalizeOem } from "@shared/oem";
import { errorMessage } from "@/shared/api/api-error";
import { autoPartsApi } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { Money, Quantity } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { useOnline } from "@/shared/hooks/use-online";
import {
  readSnapshot,
  searchProductsOffline,
  type OfflineProductResult,
} from "@/shared/offline/snapshot";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

interface ResultRow {
  id: string;
  sku: string;
  name: string;
  oemReference: string;
  manufacturerName: string | null;
  countryName: string | null;
  qualityLabel: string | null;
  salePriceCents: number;
  stockQuantity: number | null;
  unit: string;
}

export default function OemSearchPage() {
  const online = useOnline();
  const [reference, setReference] = useState("");
  const debounced = useDebounced(reference, 350);

  const { data: snapshot } = useQuery({ queryKey: ["pos-snapshot"], queryFn: readSnapshot });

  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.autoParts.search(debounced),
    queryFn: () => autoPartsApi.searchByOem(debounced),
    enabled: online && debounced.trim().length >= 3,
    retry: false,
  });

  // Hors ligne, on rejoue la même logique sur l'instantané local.
  const offlineRows: ResultRow[] = useMemo(() => {
    if (online || !snapshot || debounced.trim().length < 3) return [];
    return (searchProductsOffline(snapshot, debounced, 50) as OfflineProductResult[]).map(
      (product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        oemReference: product.oemReference ?? "",
        manufacturerName: product.manufacturerName ?? null,
        countryName: product.countryName ?? null,
        qualityLabel: product.qualityLabel ?? null,
        salePriceCents: product.salePriceCents,
        stockQuantity: product.stockQuantity,
        unit: product.unit,
      })
    );
  }, [online, snapshot, debounced]);

  const rows: ResultRow[] =
    online && data
      ? data.items.map((item) => ({
          id: item.product.id,
          sku: item.product.sku,
          name: item.product.name,
          oemReference: item.profile.oemReference,
          manufacturerName: item.manufacturerName,
          countryName: item.countryName,
          qualityLabel: item.qualityLabel,
          salePriceCents: item.product.salePriceCents,
          stockQuantity: null,
          unit: item.product.unit,
        }))
      : offlineRows;

  const equivalents = online
    ? (data?.equivalents ?? [])
    : snapshot
      ? // Sans serveur, la classe d'équivalence se lit dans l'instantané.
        [normalizeOem(debounced)]
      : [];

  const columns: Column<ResultRow>[] = [
    {
      id: "product",
      header: "Article",
      cell: (row) => (
        <Link href={`/products/${row.id}/edit`} className="min-w-0 hover:underline">
          <p className="truncate font-medium">{row.name}</p>
          <p className="tabular text-xs text-muted-foreground">{row.sku}</p>
        </Link>
      ),
    },
    {
      id: "oem",
      header: "Référence OEM",
      cell: (row) => <span className="tabular text-sm">{row.oemReference || "—"}</span>,
    },
    {
      id: "manufacturer",
      header: "Fabricant",
      cell: (row) => row.manufacturerName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "country",
      header: "Origine",
      cell: (row) => row.countryName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "quality",
      header: "Qualité",
      cell: (row) =>
        row.qualityLabel ? (
          <Badge variant="outline">{row.qualityLabel}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "stock",
      header: "Stock",
      align: "end",
      cell: (row) =>
        row.stockQuantity === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <Quantity value={row.stockQuantity} /> {row.unit}
          </>
        ),
    },
    {
      id: "price",
      header: "Prix",
      align: "end",
      cell: (row) => <Money cents={row.salePriceCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recherche OEM"
        description="Une référence retrouve tous les articles équivalents, quel que soit le point d'entrée."
      />

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Saisir une référence OEM, par exemple 90915-10004"
              className="tabular h-12 ps-10 text-base"
              autoFocus
            />
          </div>

          {!online ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-status-pending">
              <IconCloudOff className="size-3.5" />
              Recherche effectuée sur les données locales du poste.
            </p>
          ) : null}

          {equivalents.length > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Classe d'équivalence :</span>
              {equivalents.map((entry) => (
                <Badge key={entry} variant="secondary" className="tabular">
                  {entry}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {debounced.trim().length < 3 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Saisissez au moins trois caractères pour lancer la recherche.
          </CardContent>
        </Card>
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={isFetching && online}
          error={error ? errorMessage(error) : null}
          emptyTitle="Aucun article"
          emptyDescription="Aucune pièce ne correspond à cette référence ni à ses équivalences."
          minWidthClassName="min-w-[900px]"
        />
      )}
    </div>
  );
}
