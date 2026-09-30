/**
 * Reading a write queued without network: the collection and the item it targets, what
 * it creates, what it changes on screen.
 *
 * Shared by the reflection of a write in the device's copy of the answers
 * (`offline-http.ts`) and by the answers of the desktop's local database
 * (`local/local-documents.ts`), so that both show a write waiting to be sent the same way.
 */

type Row = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `/api/quotes/<id>/status` → collection `/api/quotes`, the item, the action `status`. */
export function parseWritePath(path: string): {
  collection: string;
  itemId: string | null;
  action: string;
} {
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

/**
 * Actions that **create** a document in another collection: a provisional document is
 * reflected there, so that the destination screen opens offline.
 */
export const CREATING_ACTIONS: Record<string, string> = {
  "/api/quotes:convert": "/api/sales-orders",
  "/api/sales-orders:invoice": "/api/invoices",
};

/**
 * Collection a write creates an item in — a `POST` on the collection itself, or an
 * action turning a document into another — or `null` when it creates nothing.
 */
export function createdCollection(method: string, path: string): string | null {
  if (method !== "POST") return null;
  const { collection, itemId, action } = parseWritePath(path);
  if (!itemId) return collection;
  return CREATING_ACTIONS[`${collection}:${action}`] ?? null;
}

/**
 * What an update of an item, or an action on it (`/status`, `/close`…), changes on
 * screen: the simple fields of its body — an action does not always have a body.
 */
export function reflectedPatch(body: Row, action: string, at: string): Row {
  const patch: Row = { updatedAt: at, pendingSync: true };
  for (const [key, value] of Object.entries(body)) {
    if (action && typeof value === "object" && value !== null) continue;
    patch[key] = value;
  }
  return patch;
}
