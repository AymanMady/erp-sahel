/** Fiche d'un tiers : identité, contacts, adresses et historique des transactions. */

import { useState } from "react";
import { IconArrowLeft, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error ? errorMessage(error) : "Tiers introuvable."}
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
            <IconArrowLeft className="size-4" />
            Retour
          </Link>
        </Button>
        {can("parties.write") ? <Button onClick={() => setEditing(true)}>Modifier</Button> : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Encours actuel</CardDescription>
            <CardTitle className="text-2xl">
              <Money cents={data.outstandingCents} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.creditLimitCents > 0 ? (
              <>
                Plafond autorisé : <Money cents={data.creditLimitCents} />
              </>
            ) : (
              "Aucun plafond d'encours défini."
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Conditions de règlement</CardDescription>
            <CardTitle className="text-2xl tabular">
              {data.paymentTermsDays > 0 ? `${data.paymentTermsDays} jours` : "Comptant"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {data.defaultLeadTimeDays > 0
              ? `Délai de livraison fournisseur : ${data.defaultLeadTimeDays} jours`
              : "Aucun délai de livraison par défaut."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Coordonnées</CardDescription>
            <CardTitle className="text-base">{data.phone || "—"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>{data.email || "Aucun e-mail"}</p>
            <p>{data.vatNumber ? `NIF ${data.vatNumber}` : "Aucun identifiant fiscal"}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Historique</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({data.contacts.length})</TabsTrigger>
          <TabsTrigger value="addresses">Adresses ({data.addresses.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Factures</CardTitle>
              <CardDescription>Documents émis pour ce tiers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.history.invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucune facture pour ce tiers.
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
              <CardTitle>Règlements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.history.payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun règlement enregistré.
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
              <CardTitle>Contacts</CardTitle>
              {can("parties.write") ? (
                <Button size="sm" variant="outline" onClick={() => setContactOpen(true)}>
                  <IconPlus className="size-4" />
                  Ajouter
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {data.contacts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun contact enregistré.
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
              <CardTitle>Adresses</CardTitle>
              {can("parties.write") ? (
                <Button size="sm" variant="outline" onClick={() => setAddressOpen(true)}>
                  <IconPlus className="size-4" />
                  Ajouter
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {data.addresses.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucune adresse enregistrée.
                </p>
              ) : (
                data.addresses.map((address) => (
                  <div key={address.id} className="rounded-md border px-3 py-2">
                    <Badge variant="outline" className="mb-1">
                      {address.addressType === "BILLING"
                        ? "Facturation"
                        : address.addressType === "SHIPPING"
                          ? "Livraison"
                          : "Autre"}
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
      toast.success("Tiers mis à jour.");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier le tiers</DialogTitle>
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
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <FieldGrid>
            <Field label="Type">
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
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="Identifiant fiscal">
              <Input
                value={form.vatNumber}
                onChange={(event) => setForm({ ...form, vatNumber: event.target.value })}
              />
            </Field>
            <Field label="Encours autorisé" hint="0 = aucun plafond">
              <MoneyInput
                valueCents={form.creditLimitCents}
                onChange={(cents) => setForm({ ...form, creditLimitCents: cents })}
              />
            </Field>
            <Field label="Délai de règlement (jours)">
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
          <Field label="Notes">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Enregistrer
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
      toast.success("Contact ajouté.");
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
          <DialogTitle>Nouveau contact</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Prénom" required>
              <Input
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                required
              />
            </Field>
            <Field label="Nom">
              <Input
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            </Field>
            <Field label="Téléphone">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label="Fonction">
            <Input
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
              placeholder="Responsable achats, comptable…"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.firstName.trim()}>
              Ajouter
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
  const [form, setForm] = useState({
    addressType: "BILLING" as (typeof ADDRESS_TYPES)[number],
    street: "",
    city: "",
    postalCode: "",
    country: "Mauritanie",
  });

  const mutation = useMutation({
    mutationFn: () => partyApi.createAddress(partyId, form),
    onSuccess: () => {
      toast.success("Adresse ajoutée.");
      onSaved();
      onOpenChange(false);
      setForm({
        addressType: "BILLING",
        street: "",
        city: "",
        postalCode: "",
        country: "Mauritanie",
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle adresse</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Type d'adresse">
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
                <SelectItem value="BILLING">Facturation</SelectItem>
                <SelectItem value="SHIPPING">Livraison</SelectItem>
                <SelectItem value="OTHER">Autre</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Rue">
            <Input
              value={form.street}
              onChange={(event) => setForm({ ...form, street: event.target.value })}
            />
          </Field>
          <FieldGrid>
            <Field label="Ville">
              <Input
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </Field>
            <Field label="Code postal">
              <Input
                value={form.postalCode}
                onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
              />
            </Field>
          </FieldGrid>
          <Field label="Pays">
            <Input
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Ajouter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
