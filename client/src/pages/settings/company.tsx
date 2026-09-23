/** Paramétrage de la société : identité, fiscalité, comptabilité. */

import { useEffect, useState } from "react";
import { IconDeviceFloppy, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ACCOUNTING_STANDARDS } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { RateInput } from "@/shared/components/money-input";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/** Limite du logo embarqué en data URI : au-delà, chaque chargement de page en pâtit. */
const MAX_LOGO_BYTES = 400 * 1024;

export default function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const { can, refresh } = useSession();
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    taxId: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    city: "",
    country: "",
    logo: "" as string | null,
    currency: "MRU",
    accountingStandard: "OHADA" as (typeof ACCOUNTING_STANDARDS)[number],
    vatEnabled: true,
    defaultVatRateBp: 1600,
    fiscalYearStartMonth: 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.company,
    queryFn: () => settingsApi.getCompany(),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name,
      legalName: data.legalName,
      taxId: data.taxId,
      email: data.email,
      phone: data.phone,
      website: data.website,
      address: data.address,
      city: data.city,
      country: data.country,
      logo: data.logo,
      currency: data.currency,
      accountingStandard: data.accountingStandard,
      vatEnabled: data.vatEnabled,
      defaultVatRateBp: data.defaultVatRateBp,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
    });
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => settingsApi.updateCompany(form),
    onSuccess: () => {
      toast.success("Paramètres enregistrés.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.company });
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const handleLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo trop volumineux (400 Ko maximum).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const readOnly = !can("settings.write");

  return (
    <div className="space-y-6">
      <PageHeader title="Société" description="Identité, fiscalité et référentiel comptable.">
        {!readOnly ? (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            <IconDeviceFloppy className="size-4" />
            Enregistrer
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Identité</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Nom commercial" required>
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Raison sociale">
                  <Input
                    value={form.legalName}
                    onChange={(event) => setForm({ ...form, legalName: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Identifiant fiscal">
                  <Input
                    value={form.taxId}
                    onChange={(event) => setForm({ ...form, taxId: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Téléphone">
                  <Input
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Site web">
                  <Input
                    value={form.website}
                    onChange={(event) => setForm({ ...form, website: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
              </FieldGrid>
              <Field label="Adresse">
                <Textarea
                  rows={2}
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <FieldGrid>
                <Field label="Ville">
                  <Input
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Pays">
                  <Input
                    value={form.country}
                    onChange={(event) => setForm({ ...form, country: event.target.value })}
                    disabled={readOnly}
                  />
                </Field>
              </FieldGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fiscalité et comptabilité</CardTitle>
              <CardDescription>
                Le référentiel comptable détermine le plan installé ; les comptes utilisés par les
                automatismes restent modifiables dans le plan comptable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Devise" hint="Code ISO à trois lettres.">
                  <Input
                    value={form.currency}
                    onChange={(event) =>
                      setForm({ ...form, currency: event.target.value.toUpperCase().slice(0, 3) })
                    }
                    disabled={readOnly}
                    className="tabular"
                  />
                </Field>
                <Field label="Référentiel comptable">
                  <Select
                    value={form.accountingStandard}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        accountingStandard: value as (typeof ACCOUNTING_STANDARDS)[number],
                      })
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNTING_STANDARDS.map((standard) => (
                        <SelectItem key={standard} value={standard}>
                          {standard}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Taux de TVA par défaut">
                  <RateInput
                    valueBp={form.defaultVatRateBp}
                    onChange={(bp) => setForm({ ...form, defaultVatRateBp: bp })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Début d'exercice">
                  <Select
                    value={String(form.fiscalYearStartMonth)}
                    onValueChange={(value) =>
                      setForm({ ...form, fiscalYearStartMonth: Number(value) })
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((month, index) => (
                        <SelectItem key={month} value={String(index + 1)}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGrid>
              <div className="flex items-center gap-3">
                <Switch
                  id="vat"
                  checked={form.vatEnabled}
                  onCheckedChange={(checked) => setForm({ ...form, vatEnabled: checked })}
                  disabled={readOnly}
                />
                <label htmlFor="vat" className="text-sm">
                  Société assujettie à la TVA
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>
              Affiché dans la barre latérale et sur les documents imprimés.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {form.logo ? (
                <img
                  src={form.logo}
                  alt="Logo de la société"
                  className="size-full object-contain"
                />
              ) : (
                <p className="text-sm text-muted-foreground">Aucun logo</p>
              )}
            </div>
            {!readOnly ? (
              <div className="space-y-2">
                <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition-colors hover:bg-muted">
                  <IconUpload className="size-4" />
                  Choisir une image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handleLogo(event.target.files?.[0])}
                  />
                </label>
                {form.logo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setForm({ ...form, logo: null })}
                  >
                    Retirer le logo
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
