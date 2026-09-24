/**
 * Product catalog — search by name, reference or barcode, filter by
 * category ([FR-SRCH-1]).
 */

import { useState } from "react";
import { IconFilter, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";

import { errorMessage } from "@/shared/api/api-error";
import { catalogApi, type ProductFilters } from "@/entities/catalog/api";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

export default function ProductsPage() {
  const { t } = useTranslation("catalog");
  const [, navigate] = useLocation();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState({ limit: 25, offset: 0 });

  const debouncedSearch = useDebounced(search);

  const { data: categories } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => catalogApi.listCategories(),
  });

  const filters: ProductFilters = {
    search: debouncedSearch || undefined,
    categoryId: categoryId === ALL ? null : categoryId,
    withStock: true,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.products(filters),
    queryFn: () => catalogApi.listProducts(filters),
  });

  const columns: Column<ProductListItem>[] = [
    {
      id: "sku",
      header: t("common:labels.reference"),
      cell: (row) => <span className="tabular text-sm font-medium">{row.sku}</span>,
    },
    {
      id: "name",
      header: t("products.designation"),
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
      header: t("common:labels.category"),
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
      header: t("products.stock"),
      align: "end",
      cell: (row) =>
        row.isService ? (
          <span className="text-xs text-muted-foreground">{t("products.serviceTag")}</span>
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
      header: t("products.salePrice"),
      align: "end",
      cell: (row) => <Money cents={row.salePriceCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("products.title")} description={t("products.description")}>
        <Button variant="outline" onClick={() => setShowFilters((value) => !value)}>
          <IconFilter className="size-4" />
          {t("products.filters")}
        </Button>
        {can("catalog.write") ? (
          <Button asChild>
            <Link href="/products/new">
              <IconPlus className="size-4" />
              {t("products.new")}
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
          placeholder={t("products.searchPlaceholder")}
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
                <SelectValue placeholder={t("common:labels.category")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("products.allCategories")}</SelectItem>
                {(categories ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("products.emptyTitle")}
        emptyDescription={t("products.emptyDescription")}
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
