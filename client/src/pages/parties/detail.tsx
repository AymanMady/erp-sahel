/** Party detail page: identity, contacts, addresses and transaction history. */

import { useState } from "react";
import { IconArrowLeft, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { toast } from "sonner";

import { ADDRESS_TYPES, PARTY_TYPES, type PartyType } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { partyApi } from "@/entities/party/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { StatusBadge, partyTypeLabel, paymentMethodLabel } from "@/shared/components/status-badge";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";

export default function PartyDetailPage() {
  const { t } = useTranslation("parties");
  const params = useParams<{ id: string }>();
  const partyId = params.id;
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.party(partyId),
    queryFn: () => partyApi.get(partyId),
    enabled: Boolean(partyId),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error ? errorMessage(error) : t("detail.notFound")}
        </CardContent>
      </Card>
    );
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.party(partyId) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.name}
        description={`${data.code} · ${partyTypeLabel(data.partyType)}`}
      >
        <Button variant="outline" asChild>
          <Link href="/parties">
            <IconArrowLeft className="size-4 rtl:rotate-180" />
            {t("common:actions.back")}
          </Link>
        </Button>
        {can("parties.write") ? (
          <Button onClick={() => setEditing(true)}>{t("common:actions.edit")}</Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("detail.outstanding")}</CardDescription>
            <CardTitle className="text-2xl">
              <Money cents={data.outstandingCents} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.creditLimitCents > 0 ? (
              <>
                {t("detail.creditLimit")} <Money cents={data.creditLimitCents} />
              </>
            ) : (
              t("detail.noCreditLimit")
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("detail.paymentTerms")}</CardDescription>
            <CardTitle className="text-2xl tabular">
              {data.paymentTermsDays > 0
                ? t("detail.termsDays", { count: data.paymentTermsDays })
                : t("detail.cash")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.defaultLeadTimeDays > 0
              ? t("detail.leadTime", { count: data.defaultLeadTimeDays })
              : t("detail.noLeadTime")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("detail.contactInfo")}</CardDescription>
            <CardTitle className="text-base" dir="ltr">
              {data.phone || "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>{data.email || t("detail.noEmail")}</p>
            <p>
              {data.vatNumber
                ? t("list.vatNumberShort", { number: data.vatNumber })
                : t("detail.noVatNumber")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">{t("detail.tabs.history")}</TabsTrigger>
          <TabsTrigger value="contacts">
            {t("detail.tabs.contacts", { n: data.contacts.length })}
          </TabsTrigger>
          <TabsTrigger value="addresses">
            {t("detail.tabs.addresses", { n: data.addresses.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.invoices.title")}</CardTitle>
              <CardDescription>{t("detail.invoices.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.history.invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("detail.invoices.empty")}
                </p>
              ) : (
                data.history.invoices.map((invoice) => (
                  <Link
                    key={invoice.id}
                    href={`/invoices/${invoice.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="tabular text-sm font-medium">{invoice.number}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(invoice.date)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={invoice.status} />
                      <Money cents={invoice.totalTtcCents} className="text-sm font-medium" />
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("detail.payments.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.history.payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("detail.payments.empty")}
                </p>
              ) : (
                data.history.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="tabular text-sm font-medium">{payment.number}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(payment.paymentDate)} ·{" "}
                        {paymentMethodLabel(payment.paymentMethod)}
                      </p>
                    </div>
                    <Money
                      cents={
                        payment.direction === "IN" ? payment.amountCents : -payment.amountCents
                      }
                      tone="auto"
                      className="text-sm font-medium"
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{t("detail.contacts.title")}</CardTitle>
              {can("parties.write") ? (
                <Button size="sm" variant="outline" onClick={() => setContactOpen(true)}>
                  <IconPlus className="size-4" />
                  {t("common:actions.add")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {data.contacts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("detail.contacts.empty")}
                </p>
              ) : (
                data.contacts.map((contact) => (
                  <div key={contact.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {contact.firstName} {contact.lastName}
                      </p>
                      {contact.role ? <Badge variant="outline">{contact.role}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[contact.phone, contact.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="addresses">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{t("detail.addresses.title")}</CardTitle>
              {can("parties.write") ? (
                <Button size="sm" variant="outline" onClick={() => setAddressOpen(true)}>
                  <IconPlus className="size-4" />
                  {t("common:actions.add")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {data.addresses.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("detail.addresses.empty")}
                </p>
              ) : (
                data.addresses.map((address) => (
                  <div key={address.id} className="rounded-md border px-3 py-2">
                    <Badge variant="outline" className="mb-1">
                      {address.addressType === "BILLING"
                        ? t("addressTypes.billing")
                        : address.addressType === "SHIPPING"
                          ? t("addressTypes.shipping")
                          : t("addressTypes.other")}
                    </Badge>
                    <p className="text-sm">{address.street}</p>
                    <p className="text-xs text-muted-foreground">
                      {[address.postalCode, address.city, address.country]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditPartyDialog
        open={editing}
        onOpenChange={setEditing}
        party={data}
        onSaved={() => void invalidate()}
      />
      <ContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        partyId={partyId}
        onSaved={() => void invalidate()}
      />
      <AddressDialog
        open={addressOpen}
        onOpenChange={setAddressOpen}
        partyId={partyId}
        onSaved={() => void invalidate()}
      />
    </div>
  );
}

function EditPartyDialog({
  open,
  onOpenChange,
  party,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: {
    id: string;
    name: string;
    partyType: string;
    email: string;
    phone: string;
    vatNumber: string;
    creditLimitCents: number;
    paymentTermsDays: number;
    notes: string;
  };
  onSaved: () => void;
}) {
  const { t } = useTranslation("parties");
  const [form, setForm] = useState({
    name: party.name,
    partyType: party.partyType as PartyType,
    email: party.email,
    phone: party.phone,
    vatNumber: party.vatNumber,
    creditLimitCents: party.creditLimitCents,
    paymentTermsDays: party.paymentTermsDays,
    notes: party.notes,
  });

  const mutation = useMutation({
    mutationFn: () => partyApi.update(party.id, form),
    onSuccess: () => {
      toast.success(t("edit.saved"));
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("common:labels.name")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <FieldGrid>
            <Field label={t("common:labels.type")}>
              <Select
                value={form.partyType}
                onValueChange={(value) => setForm({ ...form, partyType: value as PartyType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {partyTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("common:labels.phone")}>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label={t("common:labels.email")}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label={t("fields.vatNumber")}>
              <Input
                value={form.vatNumber}
                onChange={(event) => setForm({ ...form, vatNumber: event.target.value })}
              />
            </Field>
            <Field label={t("fields.creditLimit")} hint={t("fields.creditLimitHint")}>
              <MoneyInput
                valueCents={form.creditLimitCents}
                onChange={(cents) => setForm({ ...form, creditLimitCents: cents })}
              />
            </Field>
            <Field label={t("fields.paymentTermsDays")}>
              <Input
                type="number"
                min={0}
                className="tabular text-end"
                value={form.paymentTermsDays}
                onChange={(event) =>
                  setForm({ ...form, paymentTermsDays: Number(event.target.value) || 0 })
                }
              />
            </Field>
          </FieldGrid>
          <Field label={t("common:labels.notes")}>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  partyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation("parties");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "",
  });

  const mutation = useMutation({
    mutationFn: () => partyApi.createContact(partyId, form),
    onSuccess: () => {
      toast.success(t("contact.added"));
      onSaved();
      onOpenChange(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", role: "" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("contact.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label={t("contact.firstName")} required>
              <Input
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                required
              />
            </Field>
            <Field label={t("contact.lastName")}>
              <Input
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            </Field>
            <Field label={t("common:labels.phone")}>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label={t("common:labels.email")}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label={t("contact.role")}>
            <Input
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
              placeholder={t("contact.rolePlaceholder")}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.firstName.trim()}>
              {t("common:actions.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddressDialog({
  open,
  onOpenChange,
  partyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation("parties");
  const [form, setForm] = useState(() => ({
    addressType: "BILLING" as (typeof ADDRESS_TYPES)[number],
    street: "",
    city: "",
    postalCode: "",
    country: t("address.defaultCountry"),
  }));

  const mutation = useMutation({
    mutationFn: () => partyApi.createAddress(partyId, form),
    onSuccess: () => {
      toast.success(t("address.added"));
      onSaved();
      onOpenChange(false);
      setForm({
        addressType: "BILLING",
        street: "",
        city: "",
        postalCode: "",
        country: t("address.defaultCountry"),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("address.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("address.type")}>
            <Select
              value={form.addressType}
              onValueChange={(value) =>
                setForm({ ...form, addressType: value as (typeof ADDRESS_TYPES)[number] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BILLING">{t("addressTypes.billing")}</SelectItem>
                <SelectItem value="SHIPPING">{t("addressTypes.shipping")}</SelectItem>
                <SelectItem value="OTHER">{t("addressTypes.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("address.street")}>
            <Input
              value={form.street}
              onChange={(event) => setForm({ ...form, street: event.target.value })}
            />
          </Field>
          <FieldGrid>
            <Field label={t("address.city")}>
              <Input
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </Field>
            <Field label={t("address.postalCode")}>
              <Input
                value={form.postalCode}
                onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label={t("address.country")}>
            <Input
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t("common:actions.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
