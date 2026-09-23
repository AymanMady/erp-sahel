/** Persistance du point de vente : caisses et sessions. */

import { and, desc, eq } from "drizzle-orm";

import { posRegisters, posSessions, users, type PosSession } from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const posRegistersRepository = new TenantRepository(posRegisters, [
  posRegisters.code,
  posRegisters.name,
]);

export class PosRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): PosRepository {
    return new PosRepository(tx);
  }

  /** Session ouverte d'une caisse — au plus une à la fois ([FR-POS-2]). */
  async findOpenSession(companyId: string, registerId: string): Promise<PosSession | null> {
    const [row] = await this.database
      .select()
      .from(posSessions)
      .where(
        and(
          eq(posSessions.companyId, companyId),
          eq(posSessions.registerId, registerId),
          eq(posSessions.status, "OPEN")
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** Session ouverte de l'utilisateur, toutes caisses confondues. */
  async findOpenSessionForUser(companyId: string, userId: string): Promise<PosSession | null> {
    const [row] = await this.database
      .select()
      .from(posSessions)
      .where(
        and(
          eq(posSessions.companyId, companyId),
          eq(posSessions.userId, userId),
          eq(posSessions.status, "OPEN")
        )
      )
      .orderBy(desc(posSessions.openedAt))
      .limit(1);
    return row ?? null;
  }

  async findById(companyId: string, sessionId: string): Promise<PosSession | null> {
    const [row] = await this.database
      .select()
      .from(posSessions)
      .where(and(eq(posSessions.companyId, companyId), eq(posSessions.id, sessionId)))
      .limit(1);
    return row ?? null;
  }

  async findByClientUuid(companyId: string, clientUuid: string): Promise<PosSession | null> {
    const [row] = await this.database
      .select()
      .from(posSessions)
      .where(and(eq(posSessions.companyId, companyId), eq(posSessions.clientUuid, clientUuid)))
      .limit(1);
    return row ?? null;
  }

  async insertSession(values: typeof posSessions.$inferInsert): Promise<PosSession> {
    const [row] = await this.database.insert(posSessions).values(values).returning();
    return row;
  }

  async updateSession(
    companyId: string,
    sessionId: string,
    patch: Partial<typeof posSessions.$inferInsert>
  ): Promise<PosSession | null> {
    const [row] = await this.database
      .update(posSessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(posSessions.companyId, companyId), eq(posSessions.id, sessionId)))
      .returning();
    return row ?? null;
  }

  async listSessions(
    companyId: string,
    options: {
      registerId?: string | null;
      status?: PosSession["status"] | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(posSessions.companyId, companyId),
      options.registerId ? eq(posSessions.registerId, options.registerId) : undefined,
      options.status ? eq(posSessions.status, options.status) : undefined
    );
    const rows = await this.database
      .select({
        session: posSessions,
        registerName: posRegisters.name,
        registerCode: posRegisters.code,
        userName: users.username,
      })
      .from(posSessions)
      .innerJoin(posRegisters, eq(posRegisters.id, posSessions.registerId))
      .innerJoin(users, eq(users.id, posSessions.userId))
      .where(where)
      .orderBy(desc(posSessions.openedAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return rows.map((row) => ({
      ...row.session,
      registerName: row.registerName,
      registerCode: row.registerCode,
      userName: row.userName,
    }));
  }
}

export const posRepository = new PosRepository();
