/**
 * Product creation and editing.
 *
 * **Generic** product sheet: the same for any kind of goods (auto parts, clothing,
 * food…). Only the reference and the name are required.
 */

import { useEffect, useState } from "react";
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { onlineOrQueued, queueProductCreate } from "@/shared/offline/offline-writes";
import { inventoryApi } from "@/entities/inventory/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { MoneyInput, QuantityInput, RateInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";

const NONE = "NONE";

interface ProductForm {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  unit: string;
  barcode: string;
  purchasePriceCents: number;
  salePriceCents: number;
  vatRateBp: number;
  isService: boolean;
  minStock: string;
}

export default function ProductFormPage() {
  const { t } = useTranslation("catalog");
  const params = useParams<{ id?: string }>();
  const productId = params.id;
  const isEdit = Boolean(productId);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { company } = useSession();

  const [form, setForm] = useState<ProductForm>({
    sku: "",
    name: "",
    description: "",
    categoryId: NONE,
    unit: t("productForm.defaultUnit"),
    barcode: "",
    purchasePriceCents: 0,
    salePriceCents: 0,
    vatRateBp: company?.defaultVatRateBp ?? 0,
    isService: false,
    minStock: "0",
  });
  const [initialStock, setInitialStock] = useState({
    warehouseId: NONE,
    quantity: "0",
    unitCostCents: 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: existing, isLoading } = useQuery({
    queryKey: queryKeys.product(productId ?? ""),
    queryFn: () => catalogApi.getProduct(productId as string),
    enabled: isEdit,
  });

  const { data: categories } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => catalogApi.listCategories(),
  });
  const { data: warehouses } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      sku: existing.sku,
      name: existing.name,
      description: existing.description,
      categoryId: existing.categoryId ?? NONE,
      unit: existing.unit,
      barcode: existing.barcode,
      purchasePriceCents: existing.purchasePriceCents,
      salePriceCents: existing.salePriceCents,
      vatRateBp: existing.vatRateBp,
      isService: existing.isService,
      minStock: existing.minStock,
    });
  }, [existing]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        ...form,
        categoryId: form.categoryId === NONE ? null : form.categoryId,
        minStock: String(form.minStock),
      };
      if (!isEdit && !form.isService && initialStock.warehouseId !== NONE) {
        payload.initialStock = {
          warehouseId: initialStock.warehouseId,
          quantity: initialStock.quantity,
          unitCostCents: initialStock.unitCostCents,
        };
      }
      if (isEdit) {
        return catalogApi
          .updateProduct(productId as string, payload)
          .then((result) => ({ mode: "online" as const, result }));
      }
      // Offline creation: queued, replayed as-is on synchronization
      // (initial stock included).
      return onlineOrQueued(
        () => catalogApi.createProduct(payload),
        () => queueProductCreate(payload as unknown as Parameters<typeof queueProductCreate>[0])
      );
    },
    onSuccess: (outcome) => {
      const product = outcome.result;
      if (outcome.mode === "offline") {
        toast.success(t("productForm.savedOffline", { name: product.name }), {
          description: t("productForm.savedOfflineDescription"),
        });
      } else {
        toast.success(
          isEdit ? t("productForm.updated") : t("productForm.created", { name: product.name })
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.product(product.id) });
      navigate("/products");
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  if (isEdit && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? t("productForm.editTitle") : t("products.new")}
        description={t("productForm.description")}
      >
        <Button variant="outline" asChild>
          <Link href="/products">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <IconDeviceFloppy className="size-4" />
          {mutation.isPending ? t("common:states.saving") : t("common:actions.save")}
        </Button>
      </PageHeader>

      <form
        className="grid gap-6 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("productForm.generalInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label={t("common:labels.reference")} required error={errors.sku}>
                  <Input
                    value={form.sku}
                    onChange={(event) => setForm({ ...form, sku: event.target.value })}
                    required
                    className="tabular"
                  />
                </Field>
                <Field label={t("productForm.barcode")} error={errors.barcode}>
                  <Input
                    value={form.barcode}
                    onChange={(event) => setForm({ ...form, barcode: event.target.value })}
                    className="tabular"
                  />
                </Field>
              </FieldGrid>

              <Field label={t("productForm.productName")} required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </Field>

              <Field label={t("common:labels.description")}>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </Field>

              <FieldGrid>
                <Field label={t("common:labels.category")}>
                  <Select
                    value={form.categoryId}
                    onValueChange={(value) => setForm({ ...form, categoryId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("common:states.none")}</SelectItem>
                      {(categories ?? []).map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("productForm.unit")}>
                  <Input
                    value={form.unit}
                    onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  />
                </Field>
              </FieldGrid>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isService}
                  onCheckedChange={(checked) => setForm({ ...form, isService: checked === true })}
                />
                {t("productForm.nonStocked")}
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("productForm.pricing")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label={t("productForm.purchasePriceExclTax")}>
                <MoneyInput
                  valueCents={form.purchasePriceCents}
                  onChange={(cents) => setForm({ ...form, purchasePriceCents: cents })}
                />
              </Field>
              <Field label={t("productForm.salePriceExclTax")}>
                <MoneyInput
                  valueCents={form.salePriceCents}
                  onChange={(cents) => setForm({ ...form, salePriceCents: cents })}
                />
              </Field>
              <Field label={t("productForm.vatRate")}>
                <RateInput
                  valueBp={form.vatRateBp}
                  onChange={(bp) => setForm({ ...form, vatRateBp: bp })}
                />
              </Field>
              {form.salePriceCents > 0 && form.purchasePriceCents > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("productForm.margin")}{" "}
                  <span className="tabular font-medium text-foreground">
                    {(
                      ((form.salePriceCents - form.purchasePriceCents) / form.salePriceCents) *
                      100
                    ).toFixed(1)}{" "}
                    %
                  </span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          {!form.isService ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("products.stock")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={t("productForm.minStock")} hint={t("productForm.minStockHint")}>
                  <QuantityInput
                    value={form.minStock}
                    onChange={(value) => setForm({ ...form, minStock: value })}
                  />
                </Field>

                {!isEdit ? (
                  <>
                    <Field label={t("productForm.initialStockWarehouse")}>
                      <Select
                        value={initialStock.warehouseId}
                        onValueChange={(value) =>
                          setInitialStock({ ...initialStock, warehouseId: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("common:states.none")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("productForm.noInitialStock")}</SelectItem>
                          {(warehouses ?? []).map((warehouse) => (
                            <SelectItem key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {initialStock.warehouseId !== NONE ? (
                      <FieldGrid>
                        <Field label={t("common:labels.quantity")}>
                          <QuantityInput
                            value={initialStock.quantity}
                            onChange={(value) =>
                              setInitialStock({ ...initialStock, quantity: value })
                            }
                          />
                        </Field>
                        <Field label={t("productForm.unitCost")}>
                          <MoneyInput
                            valueCents={initialStock.unitCostCents}
                            onChange={(cents) =>
                              setInitialStock({ ...initialStock, unitCostCents: cents })
                            }
                          />
                        </Field>
                      </FieldGrid>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("productForm.stockEditHint")}</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </form>
    </div>
  );
}
