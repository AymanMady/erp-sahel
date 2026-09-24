/**
 * Point de vente (POS) — écran plein cadre, utilisable au comptoir.
 *
 * Contraintes qui dictent la conception :
 *  - **fonctionne hors ligne** : la recherche produit lit l'instantané local dès que le
 *    serveur est injoignable, et l'encaissement bascule dans l'outbox ([FR-POS-3]) ;
 *  - **saisie au clavier et au scanner** : le champ de recherche garde le focus, et un
 *    code-barres complet valide directement l'ajout au panier ;
 *  - **aucune ambiguïté sur l'encaissement** : le total réglé doit égaler le TTC, la
 *    monnaie à rendre est affichée en permanence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconCash,
  IconCloudOff,
  IconLock,
  IconMinus,
  IconPlus,
  IconSearch,
  IconShoppingCartOff,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";

import { PAYMENT_METHODS, type PaymentMethod } from "@shared/schema";
import { formatMoney } from "@shared/money";
import { errorMessage } from "@/shared/api/api-error";
import { catalogApi } from "@/entities/catalog/api";
import { partyApi } from "@/entities/party/api";
import { posApi } from "@/entities/pos/api";
import type { Party, ProductListItem } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { Money, useCurrency } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { paymentMethodLabel } from "@/shared/components/status-badge";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { useOnline } from "@/shared/hooks/use-online";
import { cn } from "@/shared/lib/utils";
import { readMeta, writeMeta } from "@/shared/offline/storage";
import {
  pullSnapshot,
  readSnapshot,
  searchProductsOffline,
  searchPartiesOffline,
  findByBarcodeOffline,
} from "@/shared/offline/snapshot";
import {
  cartTotals,
  checkout,
  closeSession,
  openSession,
  type CartLine,
  type TicketPayment,
} from "@/features/pos/checkout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Separator } from "@/shared/ui/separator";

const TICKET_SEQ_KEY = "pos.localTicketSeq";
const SESSION_LOCAL_KEY = "pos.localSession";

interface LocalSession {
  sessionId: string;
  clientUuid: string | null;
  registerId: string;
  openingBalanceCents: number;
}

export default function PosPage() {
  const online = useOnline();
  const queryClient = useQueryClient();
  const { company, can } = useSession();
  const currency = useCurrency();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Party | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [localSession, setLocalSession] = useState<LocalSession | null>(null);
  const [lastTicket, setLastTicket] = useState<{
    number: string;
    mode: string;
    totalTtcCents: number;
  } | null>(null);
  const debouncedSearch = useDebounced(search, 200);

  // --- Session de caisse ---------------------------------------------------
  const { data: serverSession, isLoading: sessionLoading } = useQuery({
    queryKey: queryKeys.posCurrentSession,
    // Hors ligne, la session ouverte sur le serveur est relue dans l'instantané : sans
    // elle, la caisse proposerait d'en ouvrir une seconde, refusée à la synchronisation.
    queryFn: () => posApi.currentSession(),
    refetchOnReconnect: true,
    retry: false,
  });

  useEffect(() => {
    void (async () => {
      const raw = await readMeta(SESSION_LOCAL_KEY);
      if (raw) setLocalSession(JSON.parse(raw) as LocalSession);
    })();
  }, []);

  // Une session ouverte côté serveur prime sur la session locale : c'est elle qui
  // porte les tickets déjà synchronisés.
  const activeSession: LocalSession | null = serverSession
    ? {
        sessionId: serverSession.id,
        clientUuid: null,
        registerId: serverSession.registerId,
        openingBalanceCents: serverSession.openingBalanceCents,
      }
    : localSession;

  const persistSession = useCallback(async (session: LocalSession | null) => {
    setLocalSession(session);
    await writeMeta(SESSION_LOCAL_KEY, session ? JSON.stringify(session) : "");
  }, []);

  // --- Instantané hors-ligne ----------------------------------------------
  const { data: snapshot } = useQuery({
    queryKey: ["pos-snapshot"],
    queryFn: async () => (await readSnapshot()) ?? (online ? await pullSnapshot() : null),
    staleTime: 5 * 60_000,
  });

  // --- Recherche produit ---------------------------------------------------
  const { data: onlineResults, isFetching } = useQuery({
    queryKey: ["pos-products", debouncedSearch],
    queryFn: () =>
      catalogApi.listProducts({
        search: debouncedSearch || undefined,
        withStock: true,
        isService: null,
        limit: 40,
      }),
    enabled: online,
    retry: false,
  });

  const offlineResults = useMemo(
    () => (snapshot ? searchProductsOffline(snapshot, debouncedSearch, 40) : []),
    [snapshot, debouncedSearch]
  );

  const products: ProductListItem[] =
    online && onlineResults ? onlineResults.items : (offlineResults as ProductListItem[]);

  const totals = cartTotals(cart, { vatEnabled: company?.vatEnabled ?? true });

  const addToCart = useCallback((product: ProductListItem) => {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantity: 1,
          unitPriceCents: product.salePriceCents,
          vatRateBp: product.vatRateBp,
          discountBp: 0,
        },
      ];
    });
    setSearch("");
    searchRef.current?.focus();
  }, []);

  /** Un scanner « tape » le code puis envoie Entrée : on résout alors le code-barres. */
  const handleSearchSubmit = useCallback(async () => {
    const term = search.trim();
    if (!term) return;

    if (snapshot) {
      const local = findByBarcodeOffline(snapshot, term);
      if (local) {
        addToCart(local as ProductListItem);
        return;
      }
    }
    if (online) {
      try {
        const product = await catalogApi.findByBarcode(term);
        addToCart(product);
        return;
      } catch {
        // Pas un code-barres : on laisse la liste filtrée à l'écran.
      }
    }
    // Un seul résultat affiché : l'ajouter est le geste attendu.
    if (products.length === 1) addToCart(products[0]);
  }, [search, snapshot, online, products, addToCart]);

  const updateQuantity = (productId: string, delta: number) =>
    setCart((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );

  const setQuantity = (productId: string, quantity: number) =>
    setCart((current) =>
      current
        .map((line) => (line.productId === productId ? { ...line, quantity } : line))
        .filter((line) => line.quantity > 0)
    );

  if (!can("pos.use")) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Accès refusé</CardTitle>
            <CardDescription>
              Votre profil ne dispose pas de la permission d'utiliser la caisse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">Retour au tableau de bord</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <OpenSessionScreen
        online={online}
        loading={sessionLoading && online}
        onOpened={async (session) => {
          await persistSession(session);
          void queryClient.invalidateQueries({ queryKey: queryKeys.posCurrentSession });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ----- Catalogue ----- */}
      <section className="flex min-h-0 flex-1 flex-col border-e">
        <div className="flex items-center gap-2 border-b p-3">
          <Button variant="ghost" size="icon" asChild aria-label="Quitter la caisse">
            <Link href="/">
              <IconArrowLeft className="size-5" />
            </Link>
          </Button>
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSearchSubmit();
                }
              }}
              placeholder="Scanner un code-barres ou rechercher un article…"
              className="h-11 ps-9 text-base"
              autoFocus
            />
          </div>
          {!online ? (
            <Badge variant="outline" className="gap-1 border-status-pending text-status-pending">
              <IconCloudOff className="size-3.5" />
              Hors ligne
            </Badge>
          ) : null}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.length === 0 ? (
              <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
                {isFetching
                  ? "Recherche…"
                  : search
                    ? "Aucun article ne correspond."
                    : snapshot || online
                      ? "Commencez à taper pour rechercher un article."
                      : "Aucun instantané local : connectez-vous une première fois au serveur."}
              </p>
            ) : (
              products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addToCart(product)}
                  className="flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors hover:border-primary hover:bg-muted/50 active:translate-y-px"
                >
                  <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
                  <span className="tabular text-xs text-muted-foreground">{product.sku}</span>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Money cents={product.salePriceCents} className="text-sm font-semibold" />
                    {!product.isService ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "tabular text-[10px]",
                          (product.stockQuantity ?? 0) <= 0 &&
                            "border-status-danger text-status-danger"
                        )}
                      >
                        {product.stockQuantity ?? 0}
                      </Badge>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </section>

      {/* ----- Panier ----- */}
      <aside className="flex min-h-0 w-full flex-col bg-card lg:w-[26rem]">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-2"
            onClick={() => setCustomerOpen(true)}
          >
            <IconUser className="size-4 shrink-0" />
            <span className="truncate">{customer ? customer.name : "Client de passage"}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCloseOpen(true)}>
            <IconLock className="size-4" />
            Clôturer
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
              <IconShoppingCartOff className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">Le panier est vide.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {cart.map((line) => (
                <li key={line.productId} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {line.sku} · {formatMoney(line.unitPriceCents, currency)} / {line.unit}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label="Retirer"
                      onClick={() => setQuantity(line.productId, 0)}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Diminuer"
                        onClick={() => updateQuantity(line.productId, -1)}
                      >
                        <IconMinus className="size-3.5" />
                      </Button>
                      <Input
                        inputMode="decimal"
                        className="tabular h-8 w-16 text-center"
                        value={line.quantity}
                        onChange={(event) =>
                          setQuantity(
                            line.productId,
                            Number(event.target.value.replace(",", ".")) || 0
                          )
                        }
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Augmenter"
                        onClick={() => updateQuantity(line.productId, 1)}
                      >
                        <IconPlus className="size-3.5" />
                      </Button>
                    </div>
                    <Money
                      cents={Math.round(line.quantity * line.unitPriceCents)}
                      className="text-sm font-semibold"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="space-y-3 border-t p-3">
          <div className="space-y-1 text-sm">
            <Row label="Total HT" value={<Money cents={totals.totalHtCents} />} />
            <Row label="TVA" value={<Money cents={totals.totalVatCents} />} />
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>Total TTC</span>
              <Money cents={totals.totalTtcCents} />
            </div>
          </div>

          {lastTicket ? (
            <p className="rounded-md bg-status-success-bg px-3 py-2 text-xs text-status-success">
              Ticket {lastTicket.number} encaissé
              {lastTicket.mode === "offline" ? " (hors ligne, en attente de synchronisation)" : ""}.
            </p>
          ) : null}

          <Button
            size="lg"
            className="h-12 w-full text-base"
            disabled={cart.length === 0}
            onClick={() => setPayOpen(true)}
          >
            <IconCash className="size-5" />
            Encaisser {formatMoney(totals.totalTtcCents, currency)}
          </Button>
        </div>
      </aside>

      <CustomerDialog
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        online={online}
        onSelect={(party) => {
          setCustomer(party);
          setCustomerOpen(false);
        }}
      />

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        totalTtcCents={totals.totalTtcCents}
        online={online}
        onConfirm={async (payments) => {
          const seq = Number.parseInt((await readMeta(TICKET_SEQ_KEY)) ?? "0", 10) + 1;
          try {
            const result = await checkout(
              {
                sessionId: activeSession.sessionId,
                sessionClientUuid: activeSession.clientUuid,
                partyId: customer?.id ?? null,
                lines: cart,
                payments,
                vatEnabled: company?.vatEnabled ?? true,
                localTicketSeq: seq,
              },
              { online }
            );
            await writeMeta(TICKET_SEQ_KEY, String(seq));
            setLastTicket({
              number: result.number,
              mode: result.mode,
              totalTtcCents: result.totalTtcCents,
            });
            setCart([]);
            setCustomer(null);
            setPayOpen(false);
            void queryClient.invalidateQueries({ queryKey: queryKeys.posCurrentSession });
            toast.success(
              result.mode === "online"
                ? `Ticket ${result.number} encaissé.`
                : `Ticket ${result.number} enregistré hors ligne.`
            );
            searchRef.current?.focus();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />

      <CloseSessionDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        session={activeSession}
        online={online}
        onClosed={async () => {
          await persistSession(null);
          setCart([]);
          void queryClient.invalidateQueries({ queryKey: queryKeys.posCurrentSession });
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

/** Écran d'ouverture de caisse : fond de caisse et choix du poste. */
function OpenSessionScreen({
  online,
  loading,
  onOpened,
}: {
  online: boolean;
  loading: boolean;
  onOpened: (session: LocalSession) => Promise<void>;
}) {
  const [registerId, setRegisterId] = useState("");
  const [openingBalanceCents, setOpeningBalanceCents] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const { data: registers } = useQuery({
    queryKey: queryKeys.posRegisters,
    queryFn: () => posApi.listRegisters(),
    enabled: online,
    retry: false,
  });

  // Hors ligne, les caisses proviennent de l'instantané local.
  const { data: snapshot } = useQuery({ queryKey: ["pos-snapshot"], queryFn: readSnapshot });
  const availableRegisters = online && registers ? registers : (snapshot?.registers ?? []);

  useEffect(() => {
    if (!registerId && availableRegisters.length > 0) setRegisterId(availableRegisters[0].id);
  }, [availableRegisters, registerId]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ouvrir la caisse</CardTitle>
          <CardDescription>
            Déclarez le fond de caisse présent dans le tiroir avant la première vente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Vérification d'une session en cours…</p>
          ) : null}

          {!online ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              Serveur injoignable : la session sera créée localement puis synchronisée.
            </p>
          ) : null}

          <Field label="Caisse">
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner une caisse" />
              </SelectTrigger>
              <SelectContent>
                {availableRegisters.map((register) => (
                  <SelectItem key={register.id} value={register.id}>
                    {register.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fond de caisse">
            <MoneyInput valueCents={openingBalanceCents} onChange={setOpeningBalanceCents} />
          </Field>

          <div className="flex gap-2">
            <Button variant="outline" asChild className="flex-1">
              <Link href="/">Retour</Link>
            </Button>
            <Button
              className="flex-1"
              disabled={!registerId || submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  const result = await openSession({ registerId, openingBalanceCents }, { online });
                  await onOpened({
                    sessionId: result.sessionId,
                    clientUuid: result.clientUuid,
                    registerId,
                    openingBalanceCents,
                  });
                  toast.success(
                    result.mode === "online"
                      ? "Caisse ouverte."
                      : "Caisse ouverte hors ligne, synchronisation au retour du réseau."
                  );
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Ouverture…" : "Ouvrir la caisse"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
  online,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  online: boolean;
  onSelect: (party: Party | null) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 200);

  const { data: onlineParties } = useQuery({
    queryKey: ["pos-parties", debounced],
    queryFn: () => partyApi.list({ search: debounced || undefined, role: "CUSTOMER", limit: 30 }),
    enabled: online && open,
    retry: false,
  });
  const { data: snapshot } = useQuery({ queryKey: ["pos-snapshot"], queryFn: readSnapshot });

  const parties: Party[] =
    online && onlineParties
      ? onlineParties.items
      : snapshot
        ? searchPartiesOffline(snapshot, debounced, 30)
        : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Client du ticket</DialogTitle>
          <DialogDescription>
            Sans sélection, la vente est rattachée au client de passage.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nom, code, téléphone…"
          autoFocus
        />
        <ScrollArea className="max-h-72">
          <div className="space-y-1">
            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-start text-sm transition-colors hover:bg-muted"
              onClick={() => onSelect(null)}
            >
              Client de passage
            </button>
            {parties.map((party) => (
              <button
                key={party.id}
                type="button"
                className="w-full rounded-md px-3 py-2 text-start transition-colors hover:bg-muted"
                onClick={() => onSelect(party)}
              >
                <p className="text-sm font-medium">{party.name}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {party.code}
                  {party.phone ? ` · ${party.phone}` : ""}
                </p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  totalTtcCents,
  online,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalTtcCents: number;
  online: boolean;
  onConfirm: (payments: TicketPayment[]) => Promise<void>;
}) {
  const currency = useCurrency();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [receivedCents, setReceivedCents] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReceivedCents(totalTtcCents);
  }, [open, totalTtcCents]);

  const changeCents = Math.max(0, receivedCents - totalTtcCents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaissement</DialogTitle>
          <DialogDescription>
            Total à régler : <strong>{formatMoney(totalTtcCents, currency)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Mode de règlement">
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((entry) => (
                <Button
                  key={entry}
                  type="button"
                  variant={method === entry ? "default" : "outline"}
                  onClick={() => setMethod(entry)}
                >
                  {paymentMethodLabel(entry)}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="Montant reçu">
            <MoneyInput valueCents={receivedCents} onChange={setReceivedCents} />
          </Field>

          {method === "CASH" ? (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
              <span className="text-sm text-muted-foreground">Monnaie à rendre</span>
              <Money cents={changeCents} className="text-base font-semibold" />
            </div>
          ) : null}

          {!online ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              Hors ligne : le ticket recevra un numéro provisoire, remplacé par le numéro légal lors
              de la synchronisation.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={submitting || receivedCents < totalTtcCents || totalTtcCents <= 0}
            onClick={async () => {
              setSubmitting(true);
              try {
                // Le serveur exige l'égalité stricte : on n'encaisse jamais la monnaie
                // rendue, seulement le montant dû.
                await onConfirm([{ method, amountCents: totalTtcCents }]);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Encaissement…" : "Valider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseSessionDialog({
  open,
  onOpenChange,
  session,
  online,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: LocalSession;
  online: boolean;
  onClosed: () => Promise<void>;
}) {
  const [countedCents, setCountedCents] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ["pos-session-summary", session.sessionId],
    queryFn: () => posApi.sessionSummary(session.sessionId),
    enabled: open && online && !session.clientUuid,
    retry: false,
  });

  const expectedCents = summary?.expectedBalanceCents ?? session.openingBalanceCents;
  const differenceCents = countedCents - expectedCents;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clôture de caisse</DialogTitle>
          <DialogDescription>Comptez le tiroir et saisissez le montant constaté.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <Row label="Fond de caisse" value={<Money cents={session.openingBalanceCents} />} />
            {summary ? (
              <>
                <Row
                  label="Encaissements espèces"
                  value={<Money cents={summary.totals.cashCents} />}
                />
                <Row label="Total des ventes" value={<Money cents={summary.totals.totalCents} />} />
              </>
            ) : null}
            <Separator className="my-2" />
            <div className="flex items-center justify-between font-medium">
              <span>Attendu en caisse</span>
              <Money cents={expectedCents} />
            </div>
          </div>

          <Field label="Montant compté">
            <MoneyInput valueCents={countedCents} onChange={setCountedCents} />
          </Field>

          {countedCents > 0 ? (
            <div
              className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-sm",
                differenceCents === 0
                  ? "bg-status-success-bg text-status-success"
                  : "bg-status-danger-bg text-status-danger"
              )}
            >
              <span>Écart de caisse</span>
              <Money cents={differenceCents} />
            </div>
          ) : null}

          {!online || session.clientUuid ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              La clôture sera transmise avec les ventes en attente ; l'écart définitif sera
              recalculé par le serveur.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                const result = await closeSession(
                  {
                    sessionId: session.sessionId,
                    sessionClientUuid: session.clientUuid,
                    closingBalanceCents: countedCents,
                  },
                  { online }
                );
                await onClosed();
                onOpenChange(false);
                toast.success(
                  result.differenceCents === null
                    ? "Clôture enregistrée, en attente de synchronisation."
                    : result.differenceCents === 0
                      ? "Caisse clôturée sans écart."
                      : "Caisse clôturée avec écart."
                );
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Clôture…" : "Clôturer la caisse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
