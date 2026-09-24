/**
 * Point of sale (POS) — full-screen view, usable at the counter.
 *
 * Constraints that drive the design:
 *  - **works offline**: product search reads the local snapshot as soon as the
 *    server is unreachable, and checkout falls back to the outbox ([FR-POS-3]);
 *  - **keyboard and scanner input**: the search field keeps focus, and a complete
 *    barcode directly adds the item to the cart;
 *  - **no ambiguity at checkout**: the amount paid must equal the total incl. tax, and
 *    the change due is always displayed.
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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("pos");
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

  // --- Register session -----------------------------------------------------
  const { data: serverSession, isLoading: sessionLoading } = useQuery({
    queryKey: queryKeys.posCurrentSession,
    // Offline, the session opened on the server is read back from the snapshot: without
    // it, the register would offer to open a second one, rejected at sync time.
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

  // A server-side open session takes precedence over the local one: it holds the
  // tickets that have already been synced.
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

  // --- Offline snapshot --------------------------------------------------
  const { data: snapshot } = useQuery({
    queryKey: ["pos-snapshot"],
    queryFn: async () => (await readSnapshot()) ?? (online ? await pullSnapshot() : null),
    staleTime: 5 * 60_000,
  });

  // --- Product search ------------------------------------------------------
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

  /** A scanner "types" the code then sends Enter: the barcode is resolved at that point. */
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
        // Not a barcode: keep the filtered list on screen.
      }
    }
    // A single result is shown: adding it is the expected action.
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
            <CardTitle>{t("accessDenied.title")}</CardTitle>
            <CardDescription>{t("accessDenied.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">{t("accessDenied.backToDashboard")}</Link>
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
      {/* ----- Catalog ----- */}
      <section className="flex min-h-0 flex-1 flex-col border-e">
        <div className="flex items-center gap-2 border-b p-3">
          <Button variant="ghost" size="icon" asChild aria-label={t("exit")}>
            <Link href="/">
              <IconArrowLeft className="size-5 rtl:rotate-180" />
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
              placeholder={t("search.placeholder")}
              className="h-11 ps-9 text-base"
              autoFocus
            />
          </div>
          {!online ? (
            <Badge variant="outline" className="gap-1 border-status-pending text-status-pending">
              <IconCloudOff className="size-3.5" />
              {t("offline")}
            </Badge>
          ) : null}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.length === 0 ? (
              <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
                {isFetching
                  ? t("search.searching")
                  : search
                    ? t("search.noMatch")
                    : snapshot || online
                      ? t("search.startTyping")
                      : t("search.noSnapshot")}
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

      {/* ----- Cart ----- */}
      <aside className="flex min-h-0 w-full flex-col bg-card lg:w-[26rem]">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-2"
            onClick={() => setCustomerOpen(true)}
          >
            <IconUser className="size-4 shrink-0" />
            <span className="truncate">{customer ? customer.name : t("customer.walkIn")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCloseOpen(true)}>
            <IconLock className="size-4" />
            {t("cart.closeRegister")}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
              <IconShoppingCartOff className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{t("cart.empty")}</p>
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
                      aria-label={t("common:actions.remove")}
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
                        aria-label={t("cart.decrease")}
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
                        aria-label={t("cart.increase")}
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
            <Row
              label={t("common:labels.totalExclTax")}
              value={<Money cents={totals.totalHtCents} />}
            />
            <Row label={t("cart.vat")} value={<Money cents={totals.totalVatCents} />} />
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>{t("common:labels.totalInclTax")}</span>
              <Money cents={totals.totalTtcCents} />
            </div>
          </div>

          {lastTicket ? (
            <p className="rounded-md bg-status-success-bg px-3 py-2 text-xs text-status-success">
              {lastTicket.mode === "offline"
                ? t("cart.lastTicketOffline", { number: lastTicket.number })
                : t("cart.lastTicket", { number: lastTicket.number })}
            </p>
          ) : null}

          <Button
            size="lg"
            className="h-12 w-full text-base"
            disabled={cart.length === 0}
            onClick={() => setPayOpen(true)}
          >
            <IconCash className="size-5" />
            {t("cart.checkout", { amount: formatMoney(totals.totalTtcCents, currency) })}
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
                ? t("toasts.ticketPaid", { number: result.number })
                : t("toasts.ticketSavedOffline", { number: result.number })
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

/** Register opening screen: opening float and register selection. */
function OpenSessionScreen({
  online,
  loading,
  onOpened,
}: {
  online: boolean;
  loading: boolean;
  onOpened: (session: LocalSession) => Promise<void>;
}) {
  const { t } = useTranslation("pos");
  const [registerId, setRegisterId] = useState("");
  const [openingBalanceCents, setOpeningBalanceCents] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const { data: registers } = useQuery({
    queryKey: queryKeys.posRegisters,
    queryFn: () => posApi.listRegisters(),
    enabled: online,
    retry: false,
  });

  // Offline, registers come from the local snapshot.
  const { data: snapshot } = useQuery({ queryKey: ["pos-snapshot"], queryFn: readSnapshot });
  const availableRegisters = online && registers ? registers : (snapshot?.registers ?? []);

  useEffect(() => {
    if (!registerId && availableRegisters.length > 0) setRegisterId(availableRegisters[0].id);
  }, [availableRegisters, registerId]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("openSession.title")}</CardTitle>
          <CardDescription>{t("openSession.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("openSession.checking")}</p>
          ) : null}

          {!online ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              {t("openSession.offlineNotice")}
            </p>
          ) : null}

          <Field label={t("openSession.register")}>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger>
                <SelectValue placeholder={t("openSession.selectRegister")} />
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

          <Field label={t("openingBalance")}>
            <MoneyInput valueCents={openingBalanceCents} onChange={setOpeningBalanceCents} />
          </Field>

          <div className="flex gap-2">
            <Button variant="outline" asChild className="flex-1">
              <Link href="/">{t("common:actions.back")}</Link>
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
                      ? t("toasts.sessionOpened")
                      : t("toasts.sessionOpenedOffline")
                  );
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? t("openSession.opening") : t("openSession.submit")}
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
  const { t } = useTranslation("pos");
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
          <DialogTitle>{t("customer.title")}</DialogTitle>
          <DialogDescription>{t("customer.description")}</DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("customer.searchPlaceholder")}
          autoFocus
        />
        <ScrollArea className="max-h-72">
          <div className="space-y-1">
            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-start text-sm transition-colors hover:bg-muted"
              onClick={() => onSelect(null)}
            >
              {t("customer.walkIn")}
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
  const { t } = useTranslation("pos");
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
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>
            {t("payment.amountDue")} <strong>{formatMoney(totalTtcCents, currency)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t("payment.method")}>
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

          <Field label={t("payment.received")}>
            <MoneyInput valueCents={receivedCents} onChange={setReceivedCents} />
          </Field>

          {method === "CASH" ? (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("payment.change")}</span>
              <Money cents={changeCents} className="text-base font-semibold" />
            </div>
          ) : null}

          {!online ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              {t("payment.offlineNotice")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={submitting || receivedCents < totalTtcCents || totalTtcCents <= 0}
            onClick={async () => {
              setSubmitting(true);
              try {
                // The server requires strict equality: the change given back is never
                // recorded, only the amount due.
                await onConfirm([{ method, amountCents: totalTtcCents }]);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? t("payment.processing") : t("common:actions.validate")}
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
  const { t } = useTranslation("pos");
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
          <DialogTitle>{t("closeSession.title")}</DialogTitle>
          <DialogDescription>{t("closeSession.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <Row
              label={t("openingBalance")}
              value={<Money cents={session.openingBalanceCents} />}
            />
            {summary ? (
              <>
                <Row
                  label={t("closeSession.cashReceipts")}
                  value={<Money cents={summary.totals.cashCents} />}
                />
                <Row
                  label={t("closeSession.totalSales")}
                  value={<Money cents={summary.totals.totalCents} />}
                />
              </>
            ) : null}
            <Separator className="my-2" />
            <div className="flex items-center justify-between font-medium">
              <span>{t("closeSession.expected")}</span>
              <Money cents={expectedCents} />
            </div>
          </div>

          <Field label={t("closeSession.counted")}>
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
              <span>{t("closeSession.difference")}</span>
              <Money cents={differenceCents} />
            </div>
          ) : null}

          {!online || session.clientUuid ? (
            <p className="rounded-md bg-status-pending-bg px-3 py-2 text-xs text-status-pending">
              {t("closeSession.pendingNotice")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
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
                    ? t("toasts.closePending")
                    : result.differenceCents === 0
                      ? t("toasts.closedBalanced")
                      : t("toasts.closedWithDifference")
                );
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? t("closeSession.closing") : t("closeSession.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
