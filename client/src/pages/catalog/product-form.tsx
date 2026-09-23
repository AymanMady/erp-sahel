/**
 * Création et modification d'un produit.
 *
 * Illustration côté client de la modularité ([FR-PLAT-3], [BR-11]) : le formulaire du
 * noyau est **générique**, et le bloc de profil affiché dépend du module choisi. Seuls
 * les profils des modules activés pour la société sont proposés.
 */

import { useEffect, useState } from "react";
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";

import { GENDERS, MEASURE_UNITS, SEASONS, type ProfileType } from "@shared/schema";
import { errorMessage, fieldErrors } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { onlineOrQueued, queueProductCreate } from "@/shared/offline/offline-writes";
import { inventoryApi } from "@/entities/inventory/api";
import { autoPartsApi, clothingApi } from "@/entities/modules/api";
import type { AutoPartProfileView, ClothingProfileView, MarketProfileView } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { MoneyInput, QuantityInput, RateInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
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
  profileType: ProfileType;
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
  const params = useParams<{ id?: string }>();
  const productId = params.id;
  const isEdit = Boolean(productId);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { company, hasModule } = useSession();

  const [form, setForm] = useState<ProductForm>({
    sku: "",
    name: "",
    description: "",
    profileType: hasModule("auto_parts") ? "AUTO_PARTS" : "GENERIC",
    categoryId: NONE,
    unit: "pièce",
    barcode: "",
    purchasePriceCents: 0,
    salePriceCents: 0,
    vatRateBp: company?.defaultVatRateBp ?? 0,
    isService: false,
    minStock: "0",
  });
  const [autoPart, setAutoPart] = useState({
    oemReference: "",
    manufacturerId: NONE,
    countryId: NONE,
    qualityLevelId: NONE,
    manufacturerRef: "",
    warrantyMonths: 12,
  });
  const [clothing, setClothing] = useState({
    brand: "",
    gender: "MIXTE",
    season: "TOUTE_SAISON",
    material: "",
    collection: "",
    sizeGridId: NONE,
    colors: "",
  });
  const [market, setMarket] = useState({
    brand: "",
    measureUnit: "UNITE",
    weightGrams: 0,
    volumeMl: 0,
    taxCategory: "",
    isPerishable: false,
    expiryAlertDays: 30,
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
  const { data: manufacturers } = useQuery({
    queryKey: queryKeys.autoParts.manufacturers,
    queryFn: () => autoPartsApi.listManufacturers(),
    enabled: hasModule("auto_parts"),
  });
  const { data: countries } = useQuery({
    queryKey: queryKeys.autoParts.countries,
    queryFn: () => autoPartsApi.listCountries(),
    enabled: hasModule("auto_parts"),
  });
  const { data: qualities } = useQuery({
    queryKey: queryKeys.autoParts.qualityLevels,
    queryFn: () => autoPartsApi.listQualityLevels(),
    enabled: hasModule("auto_parts"),
  });
  const { data: sizeGrids } = useQuery({
    queryKey: queryKeys.clothing.sizeGrids,
    queryFn: () => clothingApi.listSizeGrids(),
    enabled: hasModule("clothing"),
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      sku: existing.sku,
      name: existing.name,
      description: existing.description,
      profileType: existing.profileType,
      categoryId: existing.categoryId ?? NONE,
      unit: existing.unit,
      barcode: existing.barcode,
      purchasePriceCents: existing.purchasePriceCents,
      salePriceCents: existing.salePriceCents,
      vatRateBp: existing.vatRateBp,
      isService: existing.isService,
      minStock: existing.minStock,
    });
    if (existing.profileType === "AUTO_PARTS" && existing.profile) {
      const profile = existing.profile as AutoPartProfileView;
      setAutoPart({
        oemReference: profile.oemReference ?? "",
        manufacturerId: profile.manufacturerId ?? NONE,
        countryId: profile.countryId ?? NONE,
        qualityLevelId: profile.qualityLevelId ?? NONE,
        manufacturerRef: profile.manufacturerRef ?? "",
        warrantyMonths: profile.warrantyMonths ?? 0,
      });
    }
    if (existing.profileType === "CLOTHING" && existing.profile) {
      const profile = existing.profile as ClothingProfileView;
      setClothing({
        brand: profile.brand ?? "",
        gender: profile.gender ?? "MIXTE",
        season: profile.season ?? "TOUTE_SAISON",
        material: profile.material ?? "",
        collection: profile.collection ?? "",
        sizeGridId: profile.sizeGridId ?? NONE,
        colors: (profile.colors ?? []).join(", "),
      });
    }
    if (existing.profileType === "MARKET" && existing.profile) {
      const profile = existing.profile as MarketProfileView;
      setMarket({
        brand: profile.brand ?? "",
        measureUnit: profile.measureUnit ?? "UNITE",
        weightGrams: profile.weightGrams ?? 0,
        volumeMl: profile.volumeMl ?? 0,
        taxCategory: profile.taxCategory ?? "",
        isPerishable: profile.isPerishable ?? false,
        expiryAlertDays: profile.expiryAlertDays ?? 30,
      });
    }
  }, [existing]);

  const buildProfile = (): Record<string, unknown> | null => {
    if (form.profileType === "AUTO_PARTS") {
      return {
        oemReference: autoPart.oemReference,
        manufacturerId: autoPart.manufacturerId === NONE ? null : autoPart.manufacturerId,
        countryId: autoPart.countryId === NONE ? null : autoPart.countryId,
        qualityLevelId: autoPart.qualityLevelId === NONE ? null : autoPart.qualityLevelId,
        manufacturerRef: autoPart.manufacturerRef,
        warrantyMonths: autoPart.warrantyMonths,
      };
    }
    if (form.profileType === "CLOTHING") {
      return {
        ...clothing,
        sizeGridId: clothing.sizeGridId === NONE ? null : clothing.sizeGridId,
        colors: clothing.colors
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
    }
    if (form.profileType === "MARKET") return { ...market };
    return null;
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        ...form,
        categoryId: form.categoryId === NONE ? null : form.categoryId,
        minStock: String(form.minStock),
        profile: buildProfile(),
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
      // Création hors ligne : mise en file, rejouée telle quelle à la synchronisation
      // (profil métier et stock initial compris).
      return onlineOrQueued(
        () => catalogApi.createProduct(payload),
        () => queueProductCreate(payload as unknown as Parameters<typeof queueProductCreate>[0])
      );
    },
    onSuccess: (outcome) => {
      const product = outcome.result;
      if (outcome.mode === "offline") {
        toast.success(`Produit « ${product.name} » enregistré hors ligne.`, {
          description: "Il sera créé sur le serveur à la prochaine synchronisation.",
        });
      } else {
        toast.success(isEdit ? "Produit mis à jour." : `Produit « ${product.name} » créé.`);
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

  const availableProfiles: { value: ProfileType; label: string; available: boolean }[] = [
    { value: "GENERIC", label: "Générique (aucun module)", available: true },
    { value: "AUTO_PARTS", label: "Pièce auto", available: hasModule("auto_parts") },
    { value: "CLOTHING", label: "Vêtement", available: hasModule("clothing") },
    { value: "MARKET", label: "Marchandise (marché)", available: hasModule("market") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? "Modifier le produit" : "Nouveau produit"}
        description="Fiche générique du catalogue, étendue par le profil du module choisi."
      >
        <Button variant="outline" asChild>
          <Link href="/products">
            <IconArrowLeft className="size-4" />
            Retour
          </Link>
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <IconDeviceFloppy className="size-4" />
          {mutation.isPending ? "Enregistrement…" : "Enregistrer"}
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
              <CardTitle>Informations générales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Référence interne" required error={errors.sku}>
                  <Input
                    value={form.sku}
                    onChange={(event) => setForm({ ...form, sku: event.target.value })}
                    required
                    className="tabular"
                  />
                </Field>
                <Field label="Code-barres (EAN)" error={errors.barcode}>
                  <Input
                    value={form.barcode}
                    onChange={(event) => setForm({ ...form, barcode: event.target.value })}
                    className="tabular"
                  />
                </Field>
              </FieldGrid>

              <Field label="Désignation" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </Field>

              <Field label="Description">
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </Field>

              <FieldGrid>
                <Field label="Catégorie">
                  <Select
                    value={form.categoryId}
                    onValueChange={(value) => setForm({ ...form, categoryId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Aucune</SelectItem>
                      {(categories ?? []).map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Unité">
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
                Article non stocké (prestation)
              </label>
            </CardContent>
          </Card>

          {form.profileType !== "GENERIC" ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {form.profileType === "AUTO_PARTS"
                    ? "Profil pièce auto"
                    : form.profileType === "CLOTHING"
                      ? "Profil vêtement"
                      : "Profil marchandise"}
                </CardTitle>
                <CardDescription>
                  Attributs fournis par le module. Ils ne modifient pas le catalogue générique.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {form.profileType === "AUTO_PARTS" ? (
                  <>
                    <FieldGrid>
                      <Field
                        label="Référence OEM"
                        hint="Plusieurs produits peuvent partager la même OEM."
                      >
                        <Input
                          value={autoPart.oemReference}
                          onChange={(event) =>
                            setAutoPart({ ...autoPart, oemReference: event.target.value })
                          }
                          className="tabular"
                        />
                      </Field>
                      <Field label="Référence fabricant">
                        <Input
                          value={autoPart.manufacturerRef}
                          onChange={(event) =>
                            setAutoPart({ ...autoPart, manufacturerRef: event.target.value })
                          }
                          className="tabular"
                        />
                      </Field>
                      <Field label="Fabricant">
                        <Select
                          value={autoPart.manufacturerId}
                          onValueChange={(value) =>
                            setAutoPart({ ...autoPart, manufacturerId: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Non renseigné</SelectItem>
                            {(manufacturers ?? []).map((manufacturer) => (
                              <SelectItem key={manufacturer.id} value={manufacturer.id}>
                                {manufacturer.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Pays d'origine">
                        <Select
                          value={autoPart.countryId}
                          onValueChange={(value) => setAutoPart({ ...autoPart, countryId: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Non renseigné</SelectItem>
                            {(countries ?? []).map((country) => (
                              <SelectItem key={country.id} value={country.id}>
                                {country.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Niveau de qualité">
                        <Select
                          value={autoPart.qualityLevelId}
                          onValueChange={(value) =>
                            setAutoPart({ ...autoPart, qualityLevelId: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Non renseigné</SelectItem>
                            {(qualities ?? []).map((quality) => (
                              <SelectItem key={quality.id} value={quality.id}>
                                {quality.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Garantie (mois)">
                        <Input
                          type="number"
                          min={0}
                          className="tabular text-end"
                          value={autoPart.warrantyMonths}
                          onChange={(event) =>
                            setAutoPart({
                              ...autoPart,
                              warrantyMonths: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </Field>
                    </FieldGrid>
                  </>
                ) : null}

                {form.profileType === "CLOTHING" ? (
                  <FieldGrid>
                    <Field label="Marque">
                      <Input
                        value={clothing.brand}
                        onChange={(event) =>
                          setClothing({ ...clothing, brand: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Genre">
                      <Select
                        value={clothing.gender}
                        onValueChange={(value) => setClothing({ ...clothing, gender: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GENDERS.map((gender) => (
                            <SelectItem key={gender} value={gender}>
                              {gender.charAt(0) + gender.slice(1).toLowerCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Saison">
                      <Select
                        value={clothing.season}
                        onValueChange={(value) => setClothing({ ...clothing, season: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SEASONS.map((season) => (
                            <SelectItem key={season} value={season}>
                              {season.replace(/_/g, " ").toLowerCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Grille de tailles">
                      <Select
                        value={clothing.sizeGridId}
                        onValueChange={(value) => setClothing({ ...clothing, sizeGridId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Aucune</SelectItem>
                          {(sizeGrids ?? []).map((grid) => (
                            <SelectItem key={grid.id} value={grid.id}>
                              {grid.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Matière">
                      <Input
                        value={clothing.material}
                        onChange={(event) =>
                          setClothing({ ...clothing, material: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Collection">
                      <Input
                        value={clothing.collection}
                        onChange={(event) =>
                          setClothing({ ...clothing, collection: event.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Couleurs"
                      hint="Séparées par des virgules. Les déclinaisons taille × couleur se génèrent ensuite."
                      className="sm:col-span-2"
                    >
                      <Input
                        value={clothing.colors}
                        onChange={(event) =>
                          setClothing({ ...clothing, colors: event.target.value })
                        }
                        placeholder="Noir, Blanc, Bleu marine"
                      />
                    </Field>
                  </FieldGrid>
                ) : null}

                {form.profileType === "MARKET" ? (
                  <FieldGrid>
                    <Field label="Marque">
                      <Input
                        value={market.brand}
                        onChange={(event) => setMarket({ ...market, brand: event.target.value })}
                      />
                    </Field>
                    <Field label="Unité de mesure">
                      <Select
                        value={market.measureUnit}
                        onValueChange={(value) => setMarket({ ...market, measureUnit: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEASURE_UNITS.map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Poids (g)">
                      <Input
                        type="number"
                        min={0}
                        className="tabular text-end"
                        value={market.weightGrams}
                        onChange={(event) =>
                          setMarket({ ...market, weightGrams: Number(event.target.value) || 0 })
                        }
                      />
                    </Field>
                    <Field label="Volume (ml)">
                      <Input
                        type="number"
                        min={0}
                        className="tabular text-end"
                        value={market.volumeMl}
                        onChange={(event) =>
                          setMarket({ ...market, volumeMl: Number(event.target.value) || 0 })
                        }
                      />
                    </Field>
                    <Field label="Catégorie de taxe">
                      <Input
                        value={market.taxCategory}
                        onChange={(event) =>
                          setMarket({ ...market, taxCategory: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Alerte avant péremption (jours)">
                      <Input
                        type="number"
                        min={0}
                        className="tabular text-end"
                        value={market.expiryAlertDays}
                        onChange={(event) =>
                          setMarket({ ...market, expiryAlertDays: Number(event.target.value) || 0 })
                        }
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <Checkbox
                        checked={market.isPerishable}
                        onCheckedChange={(checked) =>
                          setMarket({ ...market, isPerishable: checked === true })
                        }
                      />
                      Produit périssable (suivi par lot et date limite)
                    </label>
                  </FieldGrid>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Module</CardTitle>
              <CardDescription>Détermine les attributs métier disponibles.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={form.profileType}
                onValueChange={(value) => setForm({ ...form, profileType: value as ProfileType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProfiles
                    .filter((entry) => entry.available)
                    .map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tarification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Prix d'achat HT">
                <MoneyInput
                  valueCents={form.purchasePriceCents}
                  onChange={(cents) => setForm({ ...form, purchasePriceCents: cents })}
                />
              </Field>
              <Field label="Prix de vente HT">
                <MoneyInput
                  valueCents={form.salePriceCents}
                  onChange={(cents) => setForm({ ...form, salePriceCents: cents })}
                />
              </Field>
              <Field label="Taux de TVA">
                <RateInput
                  valueBp={form.vatRateBp}
                  onChange={(bp) => setForm({ ...form, vatRateBp: bp })}
                />
              </Field>
              {form.salePriceCents > 0 && form.purchasePriceCents > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Marge :{" "}
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
                <CardTitle>Stock</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Seuil d'alerte" hint="0 = aucune alerte de réapprovisionnement">
                  <QuantityInput
                    value={form.minStock}
                    onChange={(value) => setForm({ ...form, minStock: value })}
                  />
                </Field>

                {!isEdit ? (
                  <>
                    <Field label="Magasin de stock initial">
                      <Select
                        value={initialStock.warehouseId}
                        onValueChange={(value) =>
                          setInitialStock({ ...initialStock, warehouseId: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Aucun" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Aucun stock initial</SelectItem>
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
                        <Field label="Quantité">
                          <QuantityInput
                            value={initialStock.quantity}
                            onChange={(value) =>
                              setInitialStock({ ...initialStock, quantity: value })
                            }
                          />
                        </Field>
                        <Field label="Coût unitaire">
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
                  <p className="text-xs text-muted-foreground">
                    Le stock se modifie par des mouvements, jamais directement sur la fiche — c'est
                    ce qui rend le solde auditable.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </form>
    </div>
  );
}
