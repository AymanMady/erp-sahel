/**
 * File d'attente hors-ligne : persistance, ordre causal et acquittements.
 *
 * `fake-indexeddb` reproduit fidèlement IndexedDB en mémoire : ces tests vérifient donc
 * le comportement réel du stockage du poste, y compris la survie des opérations après
 * « fermeture du navigateur » (§16.3 du cahier des charges).
 */

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { offlineDb } from "../db";
import {
  acknowledge,
  countFailed,
  countPending,
  discard,
  enqueue,
  listAll,
  listPending,
  markSending,
  purgeSynced,
  retryFailed,
} from "../outbox";

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.meta.clear();
  await offlineDb.cache.clear();
});

describe("mise en file", () => {
  it("attribue un identifiant d'idempotence et une séquence croissante", async () => {
    const first = await enqueue({ entity: "core.party", payload: { name: "A" }, label: "A" });
    const second = await enqueue({ entity: "core.party", payload: { name: "B" }, label: "B" });

    expect(first.clientUuid).not.toBe(second.clientUuid);
    expect(second.localSeq).toBe(first.localSeq + 1);
    expect(first.status).toBe("pending");
  });

  it("accepte un identifiant fourni, pour lier une facture à son règlement", async () => {
    const invoiceUuid = "11111111-1111-4111-8111-111111111111";
    const invoice = await enqueue({
      clientUuid: invoiceUuid,
      entity: "invoicing.sales_invoice",
      payload: {},
      label: "Ticket",
    });
    const payment = await enqueue({
      entity: "payments.payment",
      payload: { invoiceClientUuid: invoiceUuid },
      label: "Règlement",
      dependsOn: [invoiceUuid],
    });

    expect(invoice.clientUuid).toBe(invoiceUuid);
    expect(payment.dependsOn).toEqual([invoiceUuid]);
  });

  it("conserve les opérations après réouverture de la base", async () => {
    await enqueue({ entity: "core.party", payload: { name: "Persistant" }, label: "Tiers" });
    // Fermer puis rouvrir reproduit la fermeture du navigateur.
    offlineDb.close();
    await offlineDb.open();

    expect(await countPending()).toBe(1);
  });
});

describe("ordre de rejeu", () => {
  it("restitue les opérations dans l'ordre causal, pas d'insertion", async () => {
    const a = await enqueue({ entity: "core.party", payload: {}, label: "1" });
    const b = await enqueue({ entity: "invoicing.sales_invoice", payload: {}, label: "2" });
    const c = await enqueue({ entity: "payments.payment", payload: {}, label: "3" });

    // On perturbe l'ordre d'écriture : la file doit rester triée par `localSeq`.
    await offlineDb.outbox.update(b.clientUuid, { updatedAt: new Date(0).toISOString() });

    const pending = await listPending();
    expect(pending.map((record) => record.clientUuid)).toEqual([
      a.clientUuid,
      b.clientUuid,
      c.clientUuid,
    ]);
  });
});

describe("acquittements", () => {
  it("retire de la file une opération créée ou dupliquée", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Tiers" });
    await markSending([record.clientUuid]);
    await acknowledge({
      clientUuid: record.clientUuid,
      status: "synced",
      serverId: "srv-1",
      assignedNumber: "CLI-0001",
    });

    expect(await countPending()).toBe(0);
    const [stored] = await listAll();
    expect(stored.status).toBe("synced");
    expect(stored.assignedNumber).toBe("CLI-0001");
  });

  it("garde en file une opération reportée", async () => {
    const record = await enqueue({ entity: "payments.payment", payload: {}, label: "Règlement" });
    await acknowledge({
      clientUuid: record.clientUuid,
      status: "deferred",
      error: "dépendance absente",
    });

    // Un report doit être rejoué : l'opération reste envoyable.
    const pending = await listPending();
    expect(pending.map((entry) => entry.clientUuid)).toContain(record.clientUuid);
  });

  it("compte les tentatives et permet de réessayer les erreurs", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Tiers" });
    await acknowledge({ clientUuid: record.clientUuid, status: "error", error: "refus serveur" });

    expect(await countFailed()).toBe(1);
    const [failed] = await listAll();
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("refus serveur");

    await retryFailed();
    expect(await countFailed()).toBe(0);
    expect(await countPending()).toBe(1);
  });

  it("n'abandonne une opération que sur demande explicite", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Tiers" });
    await acknowledge({ clientUuid: record.clientUuid, status: "error", error: "refus" });

    // La purge automatique ne touche jamais une opération non synchronisée.
    await purgeSynced(0);
    expect(await countFailed()).toBe(1);

    await discard(record.clientUuid);
    expect(await countFailed()).toBe(0);
  });
});

describe("purge", () => {
  it("ne supprime que les opérations synchronisées anciennes", async () => {
    const synced = await enqueue({ entity: "core.party", payload: {}, label: "Ancien" });
    await acknowledge({ clientUuid: synced.clientUuid, status: "synced", serverId: "srv" });
    await offlineDb.outbox.update(synced.clientUuid, {
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const pending = await enqueue({ entity: "core.party", payload: {}, label: "Récent" });

    const removed = await purgeSynced(7);
    expect(removed).toBe(1);

    const remaining = await listAll();
    expect(remaining.map((record) => record.clientUuid)).toEqual([pending.clientUuid]);
  });
});
