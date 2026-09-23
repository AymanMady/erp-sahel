/**
 * Répartiteur d'entités synchronisables.
 *
 * Le moteur de synchronisation ne connaît pas les domaines : il connaît une table
 * `entité → handler`. Ajouter une entité synchronisable (y compris depuis un module)
 * revient donc à enregistrer un handler, sans toucher au moteur ([FR-PLUG-1]).
 */

import type { SyncEntity } from "@shared/sync-protocol";
import type { Company } from "@shared/schema";
import type { Database } from "../../db";

/** Contexte fourni à chaque handler d'ingestion. */
export interface SyncHandlerContext {
  tx: Database;
  company: Company;
  userId: string;
  /**
   * Clé d'idempotence de l'opération en cours.
   *
   * Les entités qui portent une colonne `client_uuid` doivent la renseigner : c'est
   * elle qui relie le document au numéro provisoire affiché sur le poste, et elle
   * fournit une seconde barrière anti-doublon au niveau de la base (index unique),
   * indépendante du journal `sync_operations` ([BR-8], `SYNC_STRATEGY.md` §5).
   */
  clientUuid: string;
  /**
   * Résout le `clientUuid` d'une entité créée hors-ligne vers son identifiant serveur.
   * Lève `DeferredDependencyError` si la dépendance n'est pas encore ingérée — le
   * moteur reporte alors l'opération au cycle suivant plutôt que de l'échouer.
   */
  resolveRef(clientUuid: string): Promise<string>;
}

export interface SyncHandlerResult {
  serverId: string;
  /** Numéro légal attribué, à substituer au numéro provisoire côté client. */
  assignedNumber?: string;
}

export type SyncHandler = (
  context: SyncHandlerContext,
  payload: Record<string, unknown>
) => Promise<SyncHandlerResult>;

/** Dépendance non encore résolue : l'opération est reportée, pas rejetée. */
export class DeferredDependencyError extends Error {
  constructor(readonly clientUuid: string) {
    super(
      `Dépendance non encore synchronisée (${clientUuid}) : opération reportée au prochain cycle.`
    );
    this.name = "DeferredDependencyError";
  }
}

class SyncDispatcher {
  private readonly handlers = new Map<string, SyncHandler>();

  register(entity: SyncEntity | string, handler: SyncHandler): void {
    if (this.handlers.has(entity)) {
      throw new Error(`Handler de synchronisation déjà enregistré pour « ${entity} ».`);
    }
    this.handlers.set(entity, handler);
  }

  get(entity: string): SyncHandler | undefined {
    return this.handlers.get(entity);
  }

  entities(): string[] {
    return [...this.handlers.keys()];
  }
}

export const syncDispatcher = new SyncDispatcher();
