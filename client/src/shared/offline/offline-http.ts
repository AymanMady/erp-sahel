/**
 * File d'attente **générique** des écritures hors ligne.
 *
 * Les ventes, factures, devis, tiers, produits, règlements et mouvements de stock ont
 * leur opération de synchronisation dédiée (`offline-writes.ts`). Toutes les autres
 * écritures — catégories, magasins, commandes d'achat, trésorerie, comptabilité,
 * paramètres, rôles, utilisateurs, modules… — passent par ici : si le serveur
 * est injoignable, `http.ts` met la requête en file au lieu d'échouer, et le moteur de
 * synchronisation la rejoue telle quelle au retour du réseau.
 *
 * Garanties :
 *  - **pas de doublon** : la requête porte dès le premier envoi une clé
 *    `Idempotency-Key`, réutilisée au rejeu ; le serveur renvoie la réponse déjà
 *    produite au lieu de réécrire (`server/middleware/idempotency.ts`) ;
 *  - **ordre causal** : rejeu dans l'ordre de saisie (`localSeq`), mêlé aux opérations
 *    dédiées ;
 *  - **références locales** : un élément créé hors ligne reçoit un identifiant
 *    provisoire (la clé de la requête) ; les écritures suivantes qui le citent sont
 *    réécrites avec l'identifiant serveur au moment du rejeu ;
 *  - **affichage immédiat** : l'écriture est reflétée dans le cache de lecture, pour
 *    que la liste ou la fiche montre aussitôt ce qui vient d'être saisi.
 */

import { toast } from "sonner";

import { computeDocumentTotals } from "@shared/pricing";

import { HTTP_REQUEST_ENTITY, type OutboxRecord } from "./db";
import {
  cachedRowsOf,
  readCachedResponse,
  storeCachedResponse,
  updateCachedResponses,
} from "./http-cache";
import { enqueue } from "./outbox";
import { readSnapshot, writeSnapshot, type OfflineSnapshot } from "./snapshot";
import { refreshCounters } from "./sync-engine";

export type HttpWriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";

export interface HttpWritePayload {
  method: HttpWriteMethod;
  /** Chemin et paramètres, tels qu'envoyés au premier essai. */
  url: string;
  body?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Écritures **non** mises en file par ce module :
 *  - authentification et synchronisation — sans objet hors ligne ;
 *  - celles qui ont une opération de synchronisation dédiée, portée par leur écran
 *    (`onlineOrQueued`, caisse) : elles doivent recevoir l'erreur réseau pour basculer
 *    sur leur propre file (numéro provisoire, stock, comptabilité).
 */
const NOT_QUEUED: { method: HttpWriteMethod | "*"; pattern: RegExp }[] = [
  { method: "*", pattern: /^\/api\/auth(\/|$)/ },
  { method: "*", pattern: /^\/api\/sync(\/|$)/ },
  { method: "POST", pattern: /^\/api\/parties$/ },
  { method: "POST", pattern: /^\/api\/catalog\/products$/ },
  { method: "POST", pattern: /^\/api\/quotes$/ },
  { method: "POST", pattern: /^\/api\/invoices$/ },
  { method: "POST", pattern: /^\/api\/payments$/ },
  { method: "POST", pattern: /^\/api\/inventory\/movements$/ },
  { method: "POST", pattern: /^\/api\/pos\/tickets$/ },
  { method: "POST", pattern: /^\/api\/pos\/sessions$/ },
  { method: "POST", pattern: /^\/api\/pos\/sessions\/[^/]+\/close$/ },
];

function pathOf(url: string): string {
  return url.split("?")[0];
}

/** Vrai si cette écriture doit être mise en file générique quand le réseau manque. */
export function isQueueableWrite(method: string, url: string): boolean {
  const path = pathOf(url);
  if (!path.startsWith("/api/")) return false;
  return !NOT_QUEUED.some(
    (rule) => (rule.method === "*" || rule.method === method) && rule.pattern.test(path)
  );
}

// ─── Libellés ─────────────────────────────────────────────────────────────────

const RESOURCE_LABELS: [RegExp, string][] = [
  [/^\/api\/users/, "Utilisateur"],
  [/^\/api\/roles/, "Rôle"],
  [/^\/api\/company\/settings/, "Paramètre"],
  [/^\/api\/company/, "Société"],
  [/^\/api\/platform\/modules/, "Module"],
  [/^\/api\/catalog\/categories/, "Catégorie"],
  [/^\/api\/catalog\/products/, "Produit"],
  [/^\/api\/services/, "Prestation"],
  [/^\/api\/parties/, "Tiers"],
  [/^\/api\/warehouses/, "Magasin"],
  [/^\/api\/inventory/, "Stock"],
  [/^\/api\/quotes/, "Devis"],
  [/^\/api\/sales-orders/, "Commande client"],
  [/^\/api\/invoices/, "Facture"],
  [/^\/api\/credit-notes/, "Avoir"],
  [/^\/api\/payments/, "Règlement"],
  [/^\/api\/purchase-orders/, "Commande fournisseur"],
  [/^\/api\/goods-receipts/, "Réception"],
  [/^\/api\/supplier-invoices/, "Facture fournisseur"],
  [/^\/api\/banking/, "Trésorerie"],
  [/^\/api\/pos/, "Caisse"],
  [/^\/api\/accounting/, "Comptabilité"],
];

const ACTION_LABELS: Record<HttpWriteMethod, string> = {
  POST: "Création",
  PATCH: "Modification",
  PUT: "Modification",
  DELETE: "Suppression",
};

function describeWrite(method: HttpWriteMethod, path: string, body: unknown): string {
  const resource = RESOURCE_LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? "Écriture";
  const { itemId, action } = parsePath(path);
  const verb =
    itemId && action && method === "POST" ? `Action « ${action} »` : ACTION_LABELS[method];
  const record = (body ?? {}) as Record<string, unknown>;
  const name = [record.name, record.label, record.username, record.code, record.reference].find(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  return `${verb} — ${resource}${name ? ` « ${name} »` : ""}`;
}

// ─── Reflet local ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function parsePath(path: string): { collection: string; itemId: string | null; action: string } {
  const segments = path.split("/");
  let index = -1;
  segments.forEach((segment, position) => {
    if (UUID_PATTERN.test(segment)) index = position;
  });
  if (index === -1) return { collection: path, itemId: null, action: "" };
  return {
    collection: segments.slice(0, index).join("/"),
    itemId: segments[index],
    action: segments.slice(index + 1).join("/"),
  };
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapRows(body: unknown, map: (rows: unknown[]) => unknown[]): unknown {
  if (Array.isArray(body)) return map(body);
  if (isRow(body) && Array.isArray(body.items)) {
    const items = map(body.items);
    const delta = items.length - body.items.length;
    const total = typeof body.total === "number" ? body.total + delta : body.total;
    return { ...body, items, total };
  }
  return body;
}

/** Collections servies par l'instantané plutôt que par le cache HTTP. */
function snapshotRows(
  snapshot: OfflineSnapshot,
  collection: string
): { get(): Row[]; set(rows: Row[]): void } | null {
  const direct: Record<string, keyof OfflineSnapshot> = {
    "/api/catalog/categories": "categories",
    "/api/catalog/products": "products",
    "/api/parties": "parties",
    "/api/services": "services",
    "/api/warehouses": "warehouses",
    "/api/pos/registers": "registers",
  };
  const key = direct[collection];
  if (key) {
    return {
      get: () => snapshot[key] as unknown as Row[],
      set: (rows) => {
        (snapshot as unknown as Record<string, unknown>)[key] = rows;
      },
    };
  }
  return null;
}

async function reflectInSnapshot(collection: string, apply: (rows: Row[]) => Row[]) {
  const snapshot = await readSnapshot();
  if (!snapshot) return;
  const target = snapshotRows(snapshot, collection);
  if (!target) return;
  target.set(apply(target.get() ?? []));
  await writeSnapshot(snapshot);
}

/** Élément actuellement affiché pour cet identifiant (fiche, liste ou instantané). */
async function currentItem(collection: string, itemId: string): Promise<Row | null> {
  const detail = await readCachedResponse(`${collection}/${itemId}`);
  if (isRow(detail)) return detail;
  const fromList = (await cachedRowsOf(collection)).find((row) => isRow(row) && row.id === itemId);
  if (isRow(fromList)) return fromList;
  const snapshot = await readSnapshot();
  const target = snapshot ? snapshotRows(snapshot, collection) : null;
  return target?.get()?.find((row) => row.id === itemId) ?? null;
}

/** Numéro affiché tant que le serveur n'a pas attribué le numéro légal. */
const PENDING_NUMBER = "En attente";

/**
 * Actions qui **créent** un document dans une autre collection : on y reflète un
 * document provisoire, pour que l'écran de destination s'ouvre hors ligne.
 */
const CREATING_ACTIONS: Record<string, string> = {
  "/api/quotes:convert": "/api/sales-orders",
  "/api/sales-orders:invoice": "/api/invoices",
};

/**
 * Élément provisoire tel que l'afficheraient la liste et la fiche. Pour un document
 * (corps avec `lines`), on calcule aussi les totaux et on résout le nom du tiers, pour
 * que la fiche s'affiche comme celle d'un document serveur.
 */
async function provisionalItem(body: Row, clientUuid: string, now: string): Promise<Row> {
  const item: Row = { isActive: true, createdAt: now, ...body, id: clientUuid, updatedAt: now };
  item.pendingSync = true;
  if (!Array.isArray(body.lines)) return item;

  const lines = body.lines.filter(isRow);
  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity as string | number,
      unitPriceCents: Number(line.unitPriceCents ?? 0),
      discountBp: Number(line.discountBp ?? 0),
      vatRateBp: Number(line.vatRateBp ?? 0),
    })),
    { globalDiscountBp: Number(body.globalDiscountBp ?? 0), vatEnabled: true }
  );
  Object.assign(item, {
    number: body.number ?? PENDING_NUMBER,
    status: body.status ?? "DRAFT",
    lines: lines.map((line, index) => ({
      receivedQuantity: "0",
      deliveredQuantity: "0",
      invoicedQuantity: "0",
      ...line,
      id: `${clientUuid}:${index}`,
      totalHtCents: totals.lines[index]?.totalHtCents ?? 0,
      totalVatCents: totals.lines[index]?.totalVatCents ?? 0,
      totalTtcCents: totals.lines[index]?.totalTtcCents ?? 0,
    })),
    totalHtCents: totals.totalHtCents,
    totalVatCents: totals.totalVatCents,
    totalTtcCents: totals.totalTtcCents,
    paidCents: 0,
    balanceCents: totals.totalTtcCents,
  });

  const snapshot = await readSnapshot();
  const nameOf = (id: unknown) =>
    typeof id === "string" ? snapshot?.parties.find((party) => party.id === id)?.name : undefined;
  const partyName = nameOf(body.partyId) ?? nameOf(body.customerId);
  const supplierName = nameOf(body.supplierId);
  if (partyName) Object.assign(item, { partyName: item.partyName ?? partyName });
  if (supplierName) Object.assign(item, { supplierName: item.supplierName ?? supplierName });
  return item;
}

async function reflectCreated(collection: string, created: Row, clientUuid: string) {
  await updateCachedResponses(collection, (cached) =>
    mapRows(cached, (rows) => [created, ...rows])
  );
  await storeCachedResponse(`${collection}/${clientUuid}`, created);
  await reflectInSnapshot(collection, (rows) => [created, ...rows]);
}

/**
 * Reflète l'écriture dans les lectures locales et renvoie la réponse simulée remise à
 * l'écran appelant (l'élément créé ou modifié).
 */
async function reflectLocally(payload: HttpWritePayload, clientUuid: string): Promise<unknown> {
  const path = pathOf(payload.url);
  let { collection, itemId, action } = parsePath(path);
  const body = isRow(payload.body) ? payload.body : {};

  // Identifiant non UUID (code, clé) : on ne le reconnaît que s'il figure bien dans la
  // liste parente — `PUT /api/company/settings` ne vise pas un élément « settings ».
  if (!itemId && payload.method !== "POST") {
    const cut = path.lastIndexOf("/");
    const parent = path.slice(0, cut);
    const last = path.slice(cut + 1);
    if ((await cachedRowsOf(parent)).some((row) => isRow(row) && row.id === last)) {
      collection = parent;
      itemId = last;
      action = "";
    }
  }

  // Activation d'un module : la liste des modules reflète le nouvel état.
  const moduleToggle = /^\/api\/platform\/modules\/([^/]+)\/(enable|disable)$/.exec(path);
  if (moduleToggle) {
    const [, code, verb] = moduleToggle;
    let modules: unknown[] = [];
    await updateCachedResponses("/api/platform/modules", (cached) => {
      if (!isRow(cached) || !Array.isArray(cached.modules)) return cached;
      modules = cached.modules.map((module) =>
        isRow(module) && module.code === code ? { ...module, isEnabled: verb === "enable" } : module
      );
      return { ...cached, modules };
    });
    return { success: true, modules };
  }
  const now = new Date().toISOString();

  // Création : POST sur une collection.
  if (payload.method === "POST" && !itemId) {
    const created = await provisionalItem(body, clientUuid, now);
    await reflectCreated(collection, created, clientUuid);
    return created;
  }

  // Transformation d'un document en un autre (devis → commande, commande → facture).
  const target = itemId ? CREATING_ACTIONS[`${collection}:${action}`] : undefined;
  if (payload.method === "POST" && itemId && target) {
    const source = (await currentItem(collection, itemId)) ?? {};
    const { id: _id, number: _number, status: _status, ...copied } = source;
    const created = await provisionalItem(
      { ...copied, ...body, date: now.slice(0, 10) },
      clientUuid,
      now
    );
    await reflectCreated(target, created, clientUuid);
    return created;
  }

  // Suppression.
  if (payload.method === "DELETE" && itemId && !action) {
    const keep = (row: unknown) => !(isRow(row) && row.id === itemId);
    await updateCachedResponses(collection, (cached) =>
      mapRows(cached, (rows) => rows.filter(keep))
    );
    await updateCachedResponses(`${collection}/${itemId}`, () => undefined);
    await reflectInSnapshot(collection, (rows) => rows.filter(keep));
    return undefined;
  }

  // Modification d'un élément, ou action sur celui-ci (`/status`, `/close`…) : seuls
  // les champs simples du corps sont reportés — une action n'a pas toujours de corps.
  if (itemId) {
    const patch: Row = { updatedAt: now, pendingSync: true };
    for (const [key, value] of Object.entries(body)) {
      if (action && typeof value === "object" && value !== null) continue;
      patch[key] = value;
    }
    const merge = (row: unknown) => (isRow(row) && row.id === itemId ? { ...row, ...patch } : row);
    const base = await currentItem(collection, itemId);
    await updateCachedResponses(collection, (cached) => mapRows(cached, (rows) => rows.map(merge)));
    await updateCachedResponses(`${collection}/${itemId}`, (cached) =>
      isRow(cached) ? { ...cached, ...patch } : cached
    );
    await reflectInSnapshot(collection, (rows) => rows.map((row) => merge(row) as Row));
    return { ...(base ?? {}), ...patch, id: itemId };
  }

  // Écriture sur une ressource sans identifiant (`PATCH /api/company`,
  // `PUT /api/company/settings`) : fusion dans l'objet, ou mise à jour par clé.
  await updateCachedResponses(collection, (cached) => {
    if (Array.isArray(cached) && typeof body.key === "string") {
      const others = cached.filter((row) => !(isRow(row) && row.key === body.key));
      return [...others, body];
    }
    return isRow(cached) && !Array.isArray(cached.items) ? { ...cached, ...body } : cached;
  });
  const current = await readCachedResponse(collection);
  return isRow(current) ? current : { success: true, ...body };
}

// ─── Mise en file ─────────────────────────────────────────────────────────────

/**
 * Met une écriture en file et renvoie une réponse simulée. `idempotencyKey` est la clé
 * déjà envoyée au premier essai : si celui-ci a en fait atteint le serveur, le rejeu
 * ne créera rien de plus.
 */
export async function queueHttpWrite(
  payload: HttpWritePayload,
  idempotencyKey: string
): Promise<unknown> {
  const path = pathOf(payload.url);
  await enqueue({
    clientUuid: idempotencyKey,
    entity: HTTP_REQUEST_ENTITY,
    action: payload.method === "POST" && !parsePath(path).itemId ? "create" : "update",
    label: describeWrite(payload.method, path, payload.body),
    payload: { method: payload.method, url: payload.url, body: payload.body ?? null },
  });

  let result: unknown;
  try {
    result = await reflectLocally(payload, idempotencyKey);
  } catch {
    // Le reflet est un confort d'affichage : l'écriture, elle, est bien en file.
    result = isRow(payload.body) ? { ...payload.body, id: idempotencyKey } : undefined;
  }

  await refreshCounters();
  toast.info("Enregistré hors ligne", {
    id: "offline-write",
    description: "La modification sera envoyée au serveur à la prochaine synchronisation.",
  });
  return result;
}

// ─── Rejeu ────────────────────────────────────────────────────────────────────

/**
 * Remplace, dans une valeur quelconque, les identifiants provisoires par les
 * identifiants serveur connus.
 */
export function substituteIds<T>(value: T, ids: Map<string, string>): T {
  if (ids.size === 0) return value;
  if (typeof value === "string") {
    return value.replace(UUID_GLOBAL, (match) => ids.get(match.toLowerCase()) ?? match) as T;
  }
  if (Array.isArray(value)) return value.map((entry) => substituteIds(entry, ids)) as T;
  if (isRow(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteIds(entry, ids)])
    ) as T;
  }
  return value;
}

/** Requête à rejouer pour un enregistrement de la file, identifiants résolus. */
export function replayRequest(
  record: OutboxRecord,
  ids: Map<string, string>
): HttpWritePayload & { idempotencyKey: string } {
  const payload = record.payload as unknown as HttpWritePayload;
  return {
    method: payload.method,
    url: substituteIds(payload.url, ids),
    body: payload.body === null ? undefined : substituteIds(payload.body, ids),
    idempotencyKey: record.clientUuid,
  };
}
