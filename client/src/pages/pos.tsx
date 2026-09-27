/**
 * Point of sale (POS) — full-screen view, usable at the counter.
 *
 * Constraints that drive the design:
 *  - **works offline**: product search reads the local snapshot as soon as the
 *    server is unreachable, and checkout falls back to the outbox ([FR-POS-3]);
 *  - **keyboard and scanner input**: the search field keeps focus, and a complete
 *    barcode directly adds the item to the cart;
 *  - **no ambiguity at checkout**: the amount paid must equal the total, and
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

import { formatMoney, formatQuantity, parseQuantityInput } from "@shared/money";
import { ApiError, errorMessage } from "@/shared/api/api-error";
import { bankingApi } from "@/entities/banking/api";
import { catalogApi } from "@/entities/catalog/api";
import { partyApi } from "@/entities/party/api";
import { posApi } from "@/entities/pos/api";
import { settingsApi } from "@/entities/settings/api";
import type { Party, PosSession, ProductListItem, Service } from "@/entities/types";
import { invalidateMoneyAndStock, queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { useOnline } from "@/shared/hooks/use-online";
import { cn } from "@/shared/lib/utils";
import { offlineDb } from "@/shared/offline/db";
import { isNetworkError } from "@/shared/offline/offline-writes";
import { listServicesOffline } from "@/shared/offline/offline-reads";
import { readMeta, writeMeta } from "@/shared/offline/storage";
import {
  pullSnapshot,
  readSnapshot,
  searchProductsOffline,
  searchPartiesOffline,
  findByBarcodeOffline,
} from "@/shared/offline/snapshot";
import {
  cartLineKey,
  cartTotals,
  checkout,
  closeSession,
  openSession,
  pendingSessionTotals,
  type CartLine,
  type TicketPayment,
} from "@/features/pos/checkout";
import {
  PaymentAccountPicker,
  usePaymentChoices,
} from "@/features/payment-account/payment-account-picker";
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
/** Cart kept in the browser: a reload or a closed tab must not lose the sale in progress. */
const CART_STORAGE_KEY = "erp.pos.cart";
/** Unit shown on a service line, by billing type (pos namespace). */
const SERVICE_UNIT_KEYS: Record<string, string> = {
  HOURLY: "search.units.hourly",
  DAILY: "search.units.daily",
  FLAT: "search.units.flat",
};

interface StoredCart {
  cart: CartLine[];
  customer: Party | null;
}

function readStoredCart(): StoredCart {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredCart>) : null;
    return {
      cart: Array.isArray(parsed?.cart) ? parsed.cart : [],
      customer: parsed?.customer ?? null,
    };
  } catch {
    return { cart: [], customer: null };
  }
}

function writeStoredCart(value: StoredCart): void {
  try {
    if (value.cart.length === 0 && !value.customer) {
      window.localStorage.removeItem(CART_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Storage full or blocked: the cart simply lives in memory.
  }
}

/**
 * Open session as known to the server. `confirmed` is false when the answer comes
 * from the device (no internet): it must not be used to decide the session is closed.
 */
async function fetchCurrentSession(): Promise<{
  session: PosSession | null;
  confirmed: boolean;
}> {
  try {
    return { session: await posApi.currentSessionFromServer(), confirmed: true };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    // Offline, the session opened on the server is read back from the snapshot: without
    // it, the register would offer to open a second one, rejected at sync time.
    const snapshot = await readSnapshot();
    return { session: snapshot?.session ?? null, confirmed: false };
  }
}

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
  const { can, hasModule } = useSession();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>(() => readStoredCart().cart);
  const [customer, setCustomer] = useState<Party | null>(() => readStoredCart().customer);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [localSession, setLocalSession] = useState<LocalSession | null>(null);
  /** The session was closed elsewhere (another device): explained on the opening screen. */
  const [sessionClosedElsewhere, setSessionClosedElsewhere] = useState(false);
  const [lastTicket, setLastTicket] = useState<{
    number: string;
    mode: string;
    totalCents: number;
  } | null>(null);
  const debouncedSearch = useDebounced(search, 200);

  // --- Register session -----------------------------------------------------
  const {
    data: currentSession,
    dataUpdatedAt: sessionCheckedAt,
    isLoading: sessionLoading,
  } = useQuery({
    queryKey: queryKeys.posCurrentSession,
    queryFn: fetchCurrentSession,
    refetchOnReconnect: true,
    // Also checked regularly: the session may be closed from another device.
    refetchOnWindowFocus: true,
    refetchInterval: online ? 2 * 60_000 : false,
    retry: false,
  });
  const serverSession = currentSession?.session ?? null;

  useEffect(() => {
    void (async () => {
      const raw = await readMeta(SESSION_LOCAL_KEY);
      if (raw) setLocalSession(JSON.parse(raw) as LocalSession);
    })();
  }, []);

  useEffect(() => writeStoredCart({ cart, customer }), [cart, customer]);

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

  /** When this device last chose its session: older server answers do not count. */
  const sessionChosenAt = useRef(0);
  const persistSession = useCallback(async (session: LocalSession | null) => {
    sessionChosenAt.current = Date.now();
    setLocalSession(session);
    await writeMeta(SESSION_LOCAL_KEY, session ? JSON.stringify(session) : "");
  }, []);

  // The server says no session is open while this device still uses one: it was closed
  // elsewhere. Stop using it — tickets on a closed session would all be refused. A
  // session opened without internet and not yet sent is kept: the server cannot know it.
  useEffect(() => {
    if (!currentSession?.confirmed || currentSession.session || !localSession) return;
    if (sessionCheckedAt <= sessionChosenAt.current) return;
    let cancelled = false;
    void (async () => {
      if (localSession.clientUuid) {
        const opening = await offlineDb.outbox.get(localSession.clientUuid);
        if (opening && opening.status !== "synced") return;
      }
      if (cancelled) return;
      await persistSession(null);
      setSessionClosedElsewhere(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSession, sessionCheckedAt, localSession, persistSession]);

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

  // --- Service search (labor, flat fees: no stock) -----------------------------
  const canSellServices = hasModule("services") && (can("services.read") || can("catalog.read"));
  const { data: onlineServices } = useQuery({
    queryKey: ["pos-services", debouncedSearch],
    queryFn: () => settingsApi.listServices({ search: debouncedSearch || undefined, limit: 40 }),
    enabled: online && canSellServices,
    retry: false,
  });

  const offlineServices = useMemo(
    () =>
      snapshot && canSellServices
        ? listServicesOffline(snapshot, { search: debouncedSearch, limit: 40 }).items
        : [],
    [snapshot, debouncedSearch, canSellServices]
  );

  const services: Service[] = !canSellServices
    ? []
    : online && onlineServices
      ? onlineServices.items
      : offlineServices;

  const totals = cartTotals(cart);

  const addToCart = useCallback((product: ProductListItem) => {
    setCart((current) => {
      const key = cartLineKey({ productId: product.id });
      if (current.some((line) => cartLineKey(line) === key)) {
        return current.map((line) =>
          cartLineKey(line) === key ? { ...line, quantity: line.quantity + 1 } : line
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
          discountBp: 0,
        },
      ];
    });
    setSearch("");
    searchRef.current?.focus();
  }, []);

  const addServiceToCart = useCallback(
    (service: Service) => {
      setCart((current) => {
        const key = cartLineKey({ productId: null, serviceId: service.id });
        if (current.some((line) => cartLineKey(line) === key)) {
          return current.map((line) =>
            cartLineKey(line) === key ? { ...line, quantity: line.quantity + 1 } : line
          );
        }
        return [
          ...current,
          {
            productId: null,
            serviceId: service.id,
            sku: service.code,
            name: service.name,
            unit: SERVICE_UNIT_KEYS[service.billingType]
              ? t(SERVICE_UNIT_KEYS[service.billingType])
              : "",
            quantity: 1,
            unitPriceCents: service.priceCents,
            discountBp: 0,
          },
        ];
      });
      setSearch("");
      searchRef.current?.focus();
    },
    [t]
  );

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
    if (products.length === 1 && services.length === 0) addToCart(products[0]);
    else if (services.length === 1 && products.length === 0) addServiceToCart(services[0]);
  }, [search, snapshot, online, products, services, addToCart, addServiceToCart]);

  /** `key` is the line's `cartLineKey`: products and services live in the same cart. */
  const updateQuantity = (key: string, delta: number) =>
    setCart((current) =>
      current
        .map((line) =>
          cartLineKey(line) === key
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );

  const setQuantity = (key: string, quantity: number) =>
    setCart((current) =>
      current
        .map((line) => (cartLineKey(line) === key ? { ...line, quantity } : line))
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
        closedElsewhere={sessionClosedElsewhere}
        onOpened={async (session) => {
          setSessionClosedElsewhere(false);
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
            {products.length === 0 && services.length === 0 ? (
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
                        {(product.stockQuantity ?? 0) <= 0
                          ? t("search.outOfStock")
                          : t("search.inStock", {
                              quantity: formatQuantity(product.stockQuantity ?? 0),
                            })}
                      </Badge>
                    ) : null}
                  </div>
                </button>
              ))
            )}
            {services.map((service) => (
              <button
                key={`service-${service.id}`}
                type="button"
                onClick={() => addServiceToCart(service)}
                className="flex flex-col gap-1 rounded-lg border p-3 text-start transition-colors hover:border-primary hover:bg-muted/50 active:translate-y-px"
              >
                <span className="line-clamp-2 text-sm font-medium">{service.name}</span>
                <span className="tabular text-xs text-muted-foreground">{service.code}</span>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <Money cents={service.priceCents} className="text-sm font-semibold" />
                  <Badge variant="outline" className="text-[10px]">
                    {t("search.service")}
                  </Badge>
                </div>
              </button>
            ))}
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
                <li key={cartLineKey(line)} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {line.sku} · {formatMoney(line.unitPriceCents)} / {line.unit}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={t("common:actions.remove")}
                      onClick={() => setQuantity(cartLineKey(line), 0)}
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
                        onClick={() => updateQuantity(cartLineKey(line), -1)}
                      >
                        <IconMinus className="size-3.5" />
                      </Button>
                      <CartQuantityInput
                        quantity={line.quantity}
                        label={t("cart.quantity", { name: line.name })}
                        onChange={(quantity) => setQuantity(cartLineKey(line), quantity)}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label={t("cart.increase")}
                        onClick={() => updateQuantity(cartLineKey(line), 1)}
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
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>{t("common:labels.total")}</span>
              <Money cents={totals.totalCents} />
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
            {t("cart.checkout", { amount: formatMoney(totals.totalCents) })}
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
        totalCents={totals.totalCents}
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
                localTicketSeq: seq,
              },
              { online }
            );
            await writeMeta(TICKET_SEQ_KEY, String(seq));
            setLastTicket({
              number: result.number,
              mode: result.mode,
              totalCents: result.totalCents,
            });
            setCart([]);
            setCustomer(null);
            setPayOpen(false);
            // Stock, money in the till, customer debt, dashboard: all changed.
            invalidateMoneyAndStock(queryClient);
            toast.success(
              result.mode === "online"
                ? t("toasts.ticketPaid", { number: result.number })
                : t("toasts.ticketSavedOffline", { number: result.number })
            );
            searchRef.current?.focus();
          } catch (error) {
            if (
              error instanceof ApiError &&
              (error.code === "POS_SESSION_CLOSED" ||
                error.code === "POS_SESSION_NOT_YOURS" ||
                error.status === 404)
            ) {
              // Maybe closed from another device, or opened by another cashier: ask the
              // server again. The cart is kept.
              setPayOpen(false);
              void queryClient.invalidateQueries({ queryKey: queryKeys.posCurrentSession });
              if (error.code === "POS_SESSION_CLOSED") {
                toast.error(t("toasts.sessionClosedElsewhere"));
                return;
              }
              if (error.code === "POS_SESSION_NOT_YOURS") {
                // This till was opened by someone else: forget it on this device and
                // let this cashier open their own.
                await persistSession(null);
                toast.error(t("toasts.sessionNotYours"));
                return;
              }
            }
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
          invalidateMoneyAndStock(queryClient);
        }}
      />
    </div>
  );
}

/**
 * Quantity of a cart line. The field may be emptied to retype the number without the
 * line disappearing: only a typed 0 removes it, when leaving the field (the bin button
 * does it directly). Arabic-Indic digits ("٣") are understood.
 */
function CartQuantityInput({
  quantity,
  label,
  onChange,
}: {
  quantity: number;
  label: string;
  onChange: (quantity: number) => void;
}) {
  const [text, setText] = useState(() => String(quantity));

  // Follow the + and − buttons, without overwriting what is being typed.
  useEffect(() => {
    setText((current) => (parseQuantityInput(current) === quantity ? current : String(quantity)));
  }, [quantity]);

  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      className="tabular h-8 w-16 text-center"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseQuantityInput(event.target.value);
        if (parsed !== null && parsed > 0) onChange(parsed);
      }}
      onBlur={() => {
        const parsed = parseQuantityInput(text);
        if (parsed === null || parsed < 0) setText(String(quantity));
        else if (parsed === 0) onChange(0);
      }}
    />
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
  closedElsewhere,
  onOpened,
}: {
  online: boolean;
  loading: boolean;
  closedElsewhere: boolean;
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

          {closedElsewhere ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {t("openSession.closedElsewhere")}
            </p>
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
  totalCents,
  online,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalCents: number;
  online: boolean;
  onConfirm: (payments: TicketPayment[]) => Promise<void>;
}) {
  const { t } = useTranslation("pos");
  const { data: accounts } = useQuery({
    queryKey: queryKeys.paymentAccounts,
    queryFn: () => bankingApi.listPaymentAccounts(),
    enabled: open,
    // Reloaded at each opening: a banking app added in the meantime appears right away.
    staleTime: 0,
  });
  // At the counter: cash or a banking app (Bankily, Masrvi, Sedad…), never a bank account.
  const choices = usePaymentChoices(accounts, { registerCash: true, types: ["MOBILE_MONEY"] });
  const [choiceKey, setChoiceKey] = useState("CASH");
  const [receivedCents, setReceivedCents] = useState(0);
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setChoiceKey("CASH");
      setReceivedCents(totalCents);
      setReference("");
    }
  }, [open, totalCents]);

  const choice = choices.find((entry) => entry.key === choiceKey) ?? choices[0];
  const isCash = choice.method === "CASH";
  const changeCents = Math.max(0, receivedCents - totalCents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("payment.title")}</DialogTitle>
          <DialogDescription>
            {t("payment.amountDue")} <strong>{formatMoney(totalCents)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t("payment.method")}>
            <PaymentAccountPicker
              choices={choices}
              value={choice.key}
              onChange={(entry) => setChoiceKey(entry.key)}
            />
          </Field>

          {isCash ? (
            <>
              <Field label={t("payment.received")}>
                <MoneyInput valueCents={receivedCents} onChange={setReceivedCents} />
              </Field>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-sm text-muted-foreground">{t("payment.change")}</span>
                <Money cents={changeCents} className="text-base font-semibold" />
              </div>
            </>
          ) : (
            <Field label={t("payment.transactionNumber")}>
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder={t("payment.transactionNumberHint")}
                className="tabular"
                dir="ltr"
              />
            </Field>
          )}

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
            disabled={submitting || (isCash && receivedCents < totalCents) || totalCents <= 0}
            onClick={async () => {
              setSubmitting(true);
              try {
                // The server requires strict equality: the change given back is never
                // recorded, only the amount due.
                await onConfirm([
                  {
                    method: choice.method,
                    amountCents: totalCents,
                    bankAccountId: choice.bankAccountId,
                    reference: reference.trim() || undefined,
                  },
                ]);
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
  /** Nothing written in "money counted": the cashier must say it really is 0. */
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  useEffect(() => {
    if (open) {
      setCountedCents(0);
      setConfirmEmpty(false);
    }
  }, [open]);

  const { data: summary } = useQuery({
    queryKey: ["pos-session-summary", session.sessionId],
    queryFn: () => posApi.sessionSummary(session.sessionId),
    enabled: open && online && !session.clientUuid,
    retry: false,
  });

  // Sales made without internet are not yet known to the server: they are added here,
  // otherwise the expected cash would be too low and show a false gap.
  const { data: pending } = useQuery({
    queryKey: ["pos-session-summary", session.sessionId, "pending"],
    queryFn: () => pendingSessionTotals(session),
    enabled: open,
    staleTime: 0,
  });

  const cashReceiptsCents = (summary?.totals.cashCents ?? 0) + (pending?.cashCents ?? 0);
  const totalSalesCents = (summary?.totals.totalCents ?? 0) + (pending?.totalCents ?? 0);
  const expectedCents = session.openingBalanceCents + cashReceiptsCents;
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
            <Row
              label={t("closeSession.cashReceipts")}
              value={<Money cents={cashReceiptsCents} />}
            />
            <Row label={t("closeSession.totalSales")} value={<Money cents={totalSalesCents} />} />
            <Separator className="my-2" />
            <div className="flex items-center justify-between font-medium">
              <span>{t("closeSession.expected")}</span>
              <Money cents={expectedCents} />
            </div>
          </div>

          <Field label={t("closeSession.counted")}>
            <MoneyInput
              valueCents={countedCents}
              onChange={(cents) => {
                setCountedCents(cents);
                setConfirmEmpty(false);
              }}
            />
          </Field>

          {confirmEmpty ? (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
            >
              {t("closeSession.emptyWarning", { amount: formatMoney(expectedCents) })}
            </p>
          ) : null}

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
            variant={confirmEmpty ? "destructive" : "default"}
            onClick={async () => {
              if (countedCents === 0 && !confirmEmpty) {
                setConfirmEmpty(true);
                return;
              }
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
            {submitting
              ? t("closeSession.closing")
              : confirmEmpty
                ? t("closeSession.confirmEmpty")
                : t("closeSession.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
