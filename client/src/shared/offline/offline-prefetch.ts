/**
 * Préchargement hors-ligne : remplit le cache HTTP (`http-cache.ts`) pour que les pages
 * **jamais ouvertes** sur ce poste restent consultables sans réseau.
 *
 * On appelle les mêmes fonctions d'API que les pages, avec leurs filtres par défaut ;
 * les listes sont demandées en grand (200 lignes) pour couvrir plusieurs pages de
 * pagination — et, hors ligne, les autres filtres sont appliqués localement à ces
 * listes (`http-cache.ts`). Les fiches de chaque document listé sont aussi préchargées.
 *
 * **Toutes** les pages de l'application sont couvertes, administration comprise.
 *
 * Coût maîtrisé : au plus une passe toutes les 30 minutes, requêtes en série limitée,
 * fiches rechargées seulement si elles ont changé depuis la passe précédente, et
 * chaque échec (droits, module inactif) est ignoré.
 */

import { addDays, todayInput } from "@shared/format";
import { accountingApi } from "@/entities/accounting/api";
import { bankingApi } from "@/entities/banking/api";
import { inventoryApi } from "@/entities/inventory/api";
import { invoicingApi } from "@/entities/invoicing/api";
import { partyApi } from "@/entities/party/api";
import { paymentApi } from "@/entities/payment/api";
import { posApi } from "@/entities/pos/api";
import { purchasingApi } from "@/entities/purchasing/api";
import { reportsApi } from "@/entities/reports/api";
import { salesApi } from "@/entities/sales/api";
import { settingsApi } from "@/entities/settings/api";
import { syncApi } from "@/entities/sync/api";
import { lastKnownOnline } from "@/shared/api/network";
import { cachedUpdatedAt } from "./http-cache";
import { readMeta, writeMeta } from "./storage";
import { readSnapshot } from "./snapshot";

const LAST_RUN_KEY = "prefetch.lastRunAt";
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const LIST_SIZE = 200;
/** Fiches préchargées par type de document : toutes celles de la liste préchargée. */
const DETAIL_COUNT = LIST_SIZE;
const CONCURRENCY = 4;

type Task = () => Promise<unknown>;

let running: Promise<void> | null = null;

async function runAll(tasks: Task[]): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      const task = tasks[index++];
      // Serveur perdu en cours de route : inutile d'enchaîner des échecs.
      if (!lastKnownOnline()) return;
      try {
        await task();
      } catch {
        // Droit manquant, module inactif… : la page correspondante restera vide.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

interface ListedRow {
  id: string;
  updatedAt: string | null;
}

function rowsOf(result: unknown): ListedRow[] {
  const items = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[] } | null)?.items ?? []);
  return items
    .map((row) => row as { id?: unknown; updatedAt?: unknown })
    .filter((row): row is { id: string; updatedAt?: unknown } => typeof row.id === "string")
    .map((row) => ({
      id: row.id,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    }))
    .slice(0, DETAIL_COUNT);
}

/**
 * Liste + fiches de ses éléments. Une fiche déjà en cache avec la même date de mise à
 * jour que la ligne de liste n'est pas redemandée : après la première passe, seules
 * les fiches modifiées transitent.
 */
function listWithDetails(
  list: () => Promise<unknown>,
  detailPath: (id: string) => string,
  detail: (id: string) => Task[]
): Task {
  return async () => {
    const rows = rowsOf(await list());
    const stale: ListedRow[] = [];
    for (const row of rows) {
      const cached = await cachedUpdatedAt(detailPath(row.id));
      if (!cached || !row.updatedAt || cached !== row.updatedAt) stale.push(row);
    }
    await runAll(stale.flatMap((row) => detail(row.id)));
  };
}

async function prefetch(): Promise<void> {
  const snapshot = await readSnapshot();
  const modules = new Set((snapshot?.modules ?? []).map((row) => row.code));
  // Un module désactivé répond 403 : inutile de précharger ses écrans. Sans liste de
  // modules (ancien instantané), on précharge tout, comme avant.
  const when = (code: string, tasks: Task[]): Task[] =>
    modules.size === 0 || modules.has(code) ? tasks : [];
  const page = { limit: LIST_SIZE, offset: 0 };
  const today = todayInput();
  const last30Days = { fromDate: addDays(today, -29), toDate: today };

  const tasks: Task[] = [
    // Tableau de bord (chaque période proposée) et rapports (périodes par défaut).
    ...[7, 30, 90].map(
      (days) => () => reportsApi.dashboard({ fromDate: addDays(today, -(days - 1)), toDate: today })
    ),
    ...when("reports", [
      () => reportsApi.sales(last30Days),
      () => reportsApi.purchases(last30Days),
      () => reportsApi.stock(null),
    ]),

    // Le référentiel (produits, tiers, stock, magasins…) vient de l'instantané ; on ne
    // précharge ici que ce qu'il ne contient pas.
    ...when("inventory", [
      () => inventoryApi.listMovements(page),
      () => inventoryApi.valuation(null),
    ]),

    // Fiches tiers (contacts, adresses, historique) : absentes de l'instantané.
    async () => {
      const parties = [...(snapshot?.parties ?? [])]
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, DETAIL_COUNT);
      const stale = [];
      for (const party of parties) {
        const cached = await cachedUpdatedAt(`/api/parties/${party.id}`);
        if (!cached || cached !== String(party.updatedAt)) stale.push(party.id);
      }
      await runAll(stale.map((id) => () => partyApi.get(id)));
    },

    // Ventes, facturation, règlements.
    ...when("sales", [
      listWithDetails(
        () => salesApi.listQuotes(page),
        (id) => `/api/quotes/${id}`,
        (id) => [() => salesApi.getQuote(id)]
      ),
      listWithDetails(
        () => salesApi.listOrders(page),
        (id) => `/api/sales-orders/${id}`,
        (id) => [() => salesApi.getOrder(id)]
      ),
    ]),
    ...when("invoicing", [
      listWithDetails(
        () => invoicingApi.list(page),
        (id) => `/api/invoices/${id}`,
        (id) => [() => invoicingApi.get(id), () => paymentApi.list({ invoiceId: id })]
      ),
      () => invoicingApi.listCreditNotes(page),
    ]),
    () => paymentApi.list(page),

    // Achats.
    ...when("purchasing", [
      listWithDetails(
        () => purchasingApi.listOrders(page),
        (id) => `/api/purchase-orders/${id}`,
        (id) => [() => purchasingApi.getOrder(id), () => purchasingApi.listReceipts(id)]
      ),
      () => purchasingApi.listReceipts(),
      () => purchasingApi.listSupplierInvoices(),
    ]),

    // Trésorerie et comptabilité.
    () => bankingApi.listAccounts(),
    ...when("banking", [() => bankingApi.totals(), () => bankingApi.listTransactions(page)]),
    ...when("accounting", [
      () => accountingApi.listAccounts(),
      () => accountingApi.listJournals(),
      () => accountingApi.listMappings(),
      () => accountingApi.listFiscalYears(),
      () => accountingApi.listEntries({ limit: 50 }),
      () => accountingApi.ledger({ limit: 50, offset: 0 }),
      () => accountingApi.balance({}),
    ]),

    // Caisse.
    ...when("pos", [
      () => posApi.listSessions(),
      ...(snapshot?.session ? [() => posApi.sessionSummary(snapshot.session!.id)] : []),
    ]),

    // Paramètres et administration (société, numérotation, modules, comptes, rôles).
    () => settingsApi.getCompany(),
    () => settingsApi.listSettings(),
    () => settingsApi.listSequences(),
    () => settingsApi.listModules(),
    () => settingsApi.listUsers(),
    () => settingsApi.listRoles(),
    () => settingsApi.listPermissions(),

    // Supervision de la synchronisation.
    () => syncApi.status(),
    () => syncApi.journal(),
  ];

  await runAll(tasks);
}

/**
 * Lance une passe de préchargement si la précédente date de plus de 30 minutes.
 * Ne lève jamais ; les appels concurrents partagent la même passe.
 */
export async function prefetchForOffline(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!lastKnownOnline()) return;
      const lastRun = Number((await readMeta(LAST_RUN_KEY)) ?? 0);
      if (!options.force && Date.now() - lastRun < MIN_INTERVAL_MS) return;
      await prefetch();
      // Horodatée seulement une fois la passe menée à bout : une passe interrompue
      // (onglet fermé, réseau perdu) est reprise au cycle suivant, pas 30 minutes après.
      if (lastKnownOnline()) await writeMeta(LAST_RUN_KEY, String(Date.now()));
    } catch {
      // Un préchargement raté se rattrapera à la passe suivante.
    } finally {
      running = null;
    }
  })();
  return running;
}
