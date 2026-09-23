/**
 * Repository générique pour les **référentiels tenant-scoped** (produits, tiers,
 * magasins, comptes, prestations…).
 *
 * Pourquoi une factory plutôt que quinze fichiers quasi identiques : la valeur d'un
 * repository est dans ses requêtes **spécifiques**. Le CRUD filtré par `company_id`,
 * lui, est un invariant d'architecture ([BR-13]) — le centraliser garantit qu'aucun
 * domaine ne peut l'oublier, et laisse chaque repository concret ne contenir que ce
 * qui lui est propre. Les domaines complexes (facturation, stock, comptabilité, POS,
 * synchronisation) gardent leur repository écrit à la main.
 */

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db, type Database } from "../../db";
import { NotFoundError } from "../errors/app-error";

/** Contrat minimal qu'une table doit respecter pour être pilotée par ce repository. */
export interface TenantTableShape {
  id: PgColumn;
  companyId: PgColumn;
  isActive: PgColumn;
  createdAt: PgColumn;
  updatedAt: PgColumn;
}

export type TenantTable = PgTable & TenantTableShape;

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Recherche plein-texte simple sur les colonnes déclarées à la construction. */
  search?: string;
  /** `true` : inclut les enregistrements archivés (soft-delete). */
  includeArchived?: boolean;
  /** Conditions additionnelles propres au domaine appelant. */
  where?: (SQL | undefined)[];
  orderBy?: SQL[];
}

export interface ListResult<TRow> {
  items: TRow[];
  total: number;
  limit: number;
  offset: number;
}

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit as number)));
}

export class TenantRepository<TTable extends TenantTable> {
  constructor(
    protected readonly table: TTable,
    /** Colonnes balayées par `options.search`. */
    protected readonly searchColumns: PgColumn[] = [],
    protected readonly database: Database = db
  ) {}

  /** Clone lié à une transaction, pour composer plusieurs repositories atomiquement. */
  withTransaction(tx: Database): this {
    const Constructor = this.constructor as new (
      table: TTable,
      searchColumns: PgColumn[],
      database: Database
    ) => this;
    return new Constructor(this.table, this.searchColumns, tx);
  }

  protected tenantScope(companyId: string, options: ListOptions = {}): SQL {
    const conditions: (SQL | undefined)[] = [
      eq(this.table.companyId, companyId),
      options.includeArchived ? undefined : eq(this.table.isActive, true),
      ...(options.where ?? []),
    ];
    if (options.search && this.searchColumns.length > 0) {
      const pattern = `%${options.search.trim()}%`;
      conditions.push(or(...this.searchColumns.map((column) => ilike(column, pattern))));
    }
    return and(...conditions.filter(Boolean)) as SQL;
  }

  async list(
    companyId: string,
    options: ListOptions = {}
  ): Promise<ListResult<TTable["$inferSelect"]>> {
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const scope = this.tenantScope(companyId, options);

    const [items, [countRow]] = await Promise.all([
      this.database
        .select()
        .from(this.table as PgTable)
        .where(scope)
        .orderBy(...(options.orderBy ?? [desc(this.table.createdAt)]))
        .limit(limit)
        .offset(offset),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(this.table as PgTable)
        .where(scope),
    ]);

    return {
      items: items as TTable["$inferSelect"][],
      total: countRow?.value ?? 0,
      limit,
      offset,
    };
  }

  /** Liste complète sans pagination — réservée aux instantanés de synchronisation. */
  async listAll(companyId: string, options: ListOptions = {}): Promise<TTable["$inferSelect"][]> {
    const rows = await this.database
      .select()
      .from(this.table as PgTable)
      .where(this.tenantScope(companyId, options))
      .orderBy(...(options.orderBy ?? [asc(this.table.createdAt)]));
    return rows as TTable["$inferSelect"][];
  }

  async findById(companyId: string, id: string): Promise<TTable["$inferSelect"] | null> {
    const [row] = await this.database
      .select()
      .from(this.table as PgTable)
      .where(and(eq(this.table.companyId, companyId), eq(this.table.id, id)))
      .limit(1);
    return (row as TTable["$inferSelect"]) ?? null;
  }

  /** Variante levant `NotFoundError` — évite un `if (!row) throw` dans chaque service. */
  async requireById(companyId: string, id: string): Promise<TTable["$inferSelect"]> {
    const row = await this.findById(companyId, id);
    if (!row) throw new NotFoundError("Enregistrement introuvable.");
    return row;
  }

  async create(
    companyId: string,
    values: Record<string, unknown>
  ): Promise<TTable["$inferSelect"]> {
    const [row] = await this.database
      // `companyId` est imposé ici et non pris du payload : une requête ne peut pas
      // écrire dans une autre société, même en forçant le corps JSON ([BR-13]).
      .insert(this.table as PgTable)
      .values({ ...values, companyId } as never)
      .returning();
    return row as TTable["$inferSelect"];
  }

  async update(
    companyId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<TTable["$inferSelect"] | null> {
    const { companyId: _ignored, id: _ignoredId, ...safePatch } = patch;
    const [row] = await this.database
      .update(this.table as PgTable)
      .set({ ...safePatch, updatedAt: new Date() } as never)
      .where(and(eq(this.table.companyId, companyId), eq(this.table.id, id)))
      .returning();
    return (row as TTable["$inferSelect"]) ?? null;
  }

  /** Archivage (soft-delete) : les référentiels ne sont jamais supprimés [NFR-DATA-2]. */
  async archive(companyId: string, id: string): Promise<boolean> {
    const rows = await this.database
      .update(this.table as PgTable)
      .set({ isActive: false, updatedAt: new Date() } as never)
      .where(and(eq(this.table.companyId, companyId), eq(this.table.id, id)))
      .returning({ id: this.table.id });
    return rows.length > 0;
  }

  async restore(companyId: string, id: string): Promise<boolean> {
    const rows = await this.database
      .update(this.table as PgTable)
      .set({ isActive: true, updatedAt: new Date() } as never)
      .where(and(eq(this.table.companyId, companyId), eq(this.table.id, id)))
      .returning({ id: this.table.id });
    return rows.length > 0;
  }

  async count(companyId: string, options: ListOptions = {}): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`count(*)::int` })
      .from(this.table as PgTable)
      .where(this.tenantScope(companyId, options));
    return row?.value ?? 0;
  }
}
