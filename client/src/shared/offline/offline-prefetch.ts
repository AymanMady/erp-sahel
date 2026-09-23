/**
 * Préchargement hors-ligne : remplit le cache HTTP (`http-cache.ts`) pour que les pages
 * **jamais ouvertes** sur ce poste restent consultables sans réseau.
 *
 * On appelle les mêmes fonctions d'API que les pages, avec leurs filtres par défaut ;
 * les listes sont demandées en grand (200 lignes) pour couvrir plusieurs pages de
 * pagination. Les fiches des documents les plus récents sont aussi préchargées.
 *
 * Coût maîtrisé : au plus une passe toutes les 30 minutes, requêtes en série limitée,
 * et chaque échec (droits, module inactif) est ignoré.
 */

import { addDays, todayInput } from "@shared/format";
import { accountingApi } from "@/entities/accounting/api";
import { bankingApi } from "@/entities/banking/api";
import { inventoryApi } from "@/entities/inventory/api";
import { invoicingApi } from "@/entities/invoicing/api";
import { autoPartsApi, clothingApi, marketApi } from "@/entities/modules/api";
import { paymentApi } from "@/entities/payment/api";
import { posApi } from "@/entities/pos/api";
import { purchasingApi } from "@/entities/purchasing/api";
import { reportsApi } from "@/entities/reports/api";
import { salesApi } from "@/entities/sales/api";
import { settingsApi } from "@/entities/settings/api";
import { lastKnownOnline } from "@/shared/api/network";
import { readMeta, writeMeta } from "./storage";
import { readSnapshot } from "./snapshot";

const LAST_RUN_KEY = "prefetch.lastRunAt";
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const LIST_SIZE = 200;
/** Fiches préchargées par type de document (les plus récentes). */
const DETAIL_COUNT = 30;
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

function idsOf(result: unknown): string[] {
  const items = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[] } | null)?.items ?? []);
  return items
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, DETAIL_COUNT);
}

/** Liste + fiches de ses premiers éléments. */
function listWithDetails(list: () => Promise<unknown>, detail: (id: string) => Task[]): Task {
  return async () => {
    const result = await list();
    await runAll(idsOf(result).flatMap(detail));
  };
}

async function prefetch(): Promise<void> {
  const snapshot = await readSnapshot();
  const modules = new Set((snapshot?.modules ?? []).map((row) => row.code));
  const page = { limit: LIST_SIZE, offset: 0 };
  const today = todayInput();
  const last30Days = { fromDate: addDays(today, -29), toDate: today };

  const tasks: Task[] = [
    // Tableau de bord et rapports (périodes par défaut des écrans).
    () => reportsApi.dashboard(last30Days),
    () => reportsApi.sales(last30Days),
    () => reportsApi.purchases(last30Days),
    () => reportsApi.stock(null),

    // Le référentiel (produits, tiers, stock, magasins…) vient de l'instantané ; on ne
    // précharge ici que ce qu'il ne contient pas.
    () => inventoryApi.listMovements(page),
    () => inventoryApi.valuation(null),

    // Ventes, facturation, règlements.
    listWithDetails(
      () => salesApi.listQuotes(page),
      (id) => [() => salesApi.getQuote(id)]
    ),
    listWithDetails(
      () => salesApi.listOrders(page),
      (id) => [() => salesApi.getOrder(id)]
    ),
    listWithDetails(
      () => invoicingApi.list(page),
      (id) => [() => invoicingApi.get(id), () => paymentApi.list({ invoiceId: id })]
    ),
    () => invoicingApi.listCreditNotes(page),
    () => paymentApi.list(page),

    // Achats.
    listWithDetails(
      () => purchasingApi.listOrders(page),
      (id) => [() => purchasingApi.getOrder(id), () => purchasingApi.listReceipts(id)]
    ),
    () => purchasingApi.listReceipts(),
    () => purchasingApi.listSupplierInvoices(),

    // Trésorerie et comptabilité.
    () => bankingApi.listAccounts(),
    () => bankingApi.totals(),
    () => bankingApi.listTransactions(page),
    () => accountingApi.listAccounts(),
    () => accountingApi.listJournals(),
    () => accountingApi.listMappings(),
    () => accountingApi.listEntries({ limit: 50 }),
    () => accountingApi.ledger({ limit: 50, offset: 0 }),
    () => accountingApi.balance({}),

    // Caisse et paramètres.
    () => posApi.listSessions(),
    () => settingsApi.getCompany(),
    () => settingsApi.listSequences(),
    () => settingsApi.listModules(),
  ];

  if (modules.has("auto_parts")) tasks.push(() => autoPartsApi.listEquivalences());
  if (modules.has("clothing")) tasks.push(() => clothingApi.listSizeGrids());
  if (modules.has("market")) {
    tasks.push(
      () => marketApi.listLots(page),
      () => marketApi.listExpiring(30)
    );
  }

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
      await writeMeta(LAST_RUN_KEY, String(Date.now()));
      await prefetch();
    } catch {
      // Un préchargement raté se rattrapera à la passe suivante.
    } finally {
      running = null;
    }
  })();
  return running;
}
