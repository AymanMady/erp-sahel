/**
 * Catalogue produits — recherche multi-critères ([FR-SRCH-1]).
 *
 * Les filtres des modules actifs (OEM, fabricant, pays, qualité pour Auto Parts) sont
 * ajoutés dynamiquement : le noyau ne les connaît pas, il relaie simplement les
 * paramètres au serveur, qui les confie au module concerné ([FR-PLAT-3]).
 */

import { useState } from "react";
import { IconFilter, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { errorMessage } from "@/shared/api/api-error";
import { catalogApi, type ProductFilters } from "@/entities/catalog/api";
import { autoPartsApi } from "@/entities/modules/api";
import type { ProductListItem } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Money, Quantity } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

export default function ProductsPage() {
  const [, navigate] = useLocation();
  const { can, hasModule } = useSession();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [oem, setOem] = useState("");
  const [manufacturerId, setManufacturerId] = useState(ALL);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState({ limit: 25, offset: 0 });

  const debouncedSearch = useDebounced(search);
  const debouncedOem = useDebounced(oem);
  const autoParts = hasModule("auto_parts");

  const { data: categories } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => catalogApi.listCategories(),
  });

  const { data: manufacturers } = useQuery({
    queryKey: queryKeys.autoParts.manufacturers,
    queryFn: () => autoPartsApi.listManufacturers(),
    enabled: autoParts,
  });

  const filters: ProductFilters = {
    search: debouncedSearch || undefined,
    categoryId: categoryId === ALL ? null : categoryId,
    withStock: true,
    oem: debouncedOem || undefined,
    manufacturerId: manufacturerId === ALL ? null : manufacturerId,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.products(filters),
    queryFn: () => catalogApi.listProducts(filters),
  });

  const columns: Column<ProductListItem>[] = [
    {
      id: "sku",
      header: "Référence",
      cell: (row) => <span className="tabular text-sm font-medium">{row.sku}</span>,
    },
    {
      id: "name",
      header: "Désignation",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.barcode ? (
            <p className="tabular text-xs text-muted-foreground">{row.barcode}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "category",
      header: "Catégorie",
      hideOnMobile: true,
      cell: (row) =>
        row.categoryName ? (
          <Badge variant="outline">{row.categoryName}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "stock",
      header: "Stock",
      align: "end",
      cell: (row) =>
        row.isService ? (
          <span className="text-xs text-muted-foreground">prestation</span>
        ) : (
          <span
            className={
              (row.stockQuantity ?? 0) <= Number(row.minStock) ? "text-status-pending" : undefined
            }
          >
            <Quantity value={row.stockQuantity ?? 0} /> {row.unit}
          </span>
        ),
    },
    {
      id: "price",
      header: "Prix de vente",
      align: "end",
      cell: (row) => <Money cents={row.salePriceCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Produits" description="Catalogue générique de la société.">
        <Button variant="outline" onClick={() => setShowFilters((value) => !value)}>
          <IconFilter className="size-4" />
          Filtres
        </Button>
        {can("catalog.write") ? (
          <Button asChild>
            <Link href="/products/new">
              <IconPlus className="size-4" />
              Nouveau produit
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder="Désignation, référence, code-barres…"
          className="sm:max-w-md"
        />

        {showFilters ? (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={categoryId}
              onValueChange={(value) => {
                setCategoryId(value);
                setPage((current) => ({ ...current, offset: 0 }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Catégorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les catégories</SelectItem>
                {(categories ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {autoParts ? (
              <>
                <Input
                  value={oem}
                  onChange={(event) => {
                    setOem(event.target.value);
                    setPage((current) => ({ ...current, offset: 0 }));
                  }}
                  placeholder="Référence OEM exacte"
                  className="tabular"
                />
                <Select
                  value={manufacturerId}
                  onValueChange={(value) => {
                    setManufacturerId(value);
                    setPage((current) => ({ ...current, offset: 0 }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Fabricant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous les fabricants</SelectItem>
                    {(manufacturers ?? []).map((manufacturer) => (
                      <SelectItem key={manufacturer.id} value={manufacturer.id}>
                        {manufacturer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" asChild>
                  <Link href="/modules/auto-parts/search">Recherche OEM avec équivalences →</Link>
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun produit"
        emptyDescription="Ajoutez vos articles pour pouvoir les vendre et suivre leur stock."
        onRowClick={(row) => navigate(`/products/${row.id}/edit`)}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
      />
    </div>
  );
}
