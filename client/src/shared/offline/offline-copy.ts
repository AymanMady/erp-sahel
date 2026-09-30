/**
 * What a read shows when the server cannot answer it — no internet, or too slow.
 *
 *  1. On the desktop, a document (quote, order, invoice, return, payment, purchase) is
 *     answered by the company's local database (`local/local-documents.ts`): it holds
 *     every document of the first synchronization, kept up to date since — pages never
 *     opened included — with the writes still waiting to be sent on top.
 *  2. Anything else, or a document the local database cannot answer (not downloaded
 *     yet, web application), comes from the device's copy of the former answers
 *     (`http-cache.ts`), filled by the preparation of the device (`offline-prefetch.ts`).
 *
 * `undefined` when neither has it: the screen shows that it needs internet.
 */

import { readCachedResponse } from "./http-cache";
import { localDocumentAnswer } from "./local/local-documents";

export async function readOfflineCopy(url: string): Promise<unknown> {
  const local = await localDocumentAnswer(url);
  if (local !== undefined) return local;
  return readCachedResponse(url);
}
