/**
 * Registre des modules : activation par société et contrôle des dépendances.
 *
 * Les modules sont décrits une seule fois dans `shared/modules-catalog.ts`. Tant
 * qu'une société n'a pas basculé un module, il est actif : une société existante garde
 * tout son périmètre. Désactiver un module ne supprime jamais de données.
 */

import { eq } from "drizzle-orm";

import { FEATURE_MODULES, moduleName } from "@shared/modules-catalog";
import { companyPlugins, type ModuleCode } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";

/** Version enregistrée avec chaque bascule (traçabilité). */
const MODULE_VERSION = "1.0.0";

function requireModule(code: string) {
  const module = FEATURE_MODULES.find((candidate) => candidate.code === code);
  if (!module) throw new NotFoundError(`Module « ${code} » inconnu.`);
  return module;
}

async function upsert(database: Database, companyId: string, code: string, isEnabled: boolean) {
  await database
    .insert(companyPlugins)
    .values({ companyId, pluginCode: code, isEnabled, enabledVersion: MODULE_VERSION })
    .onConflictDoUpdate({
      target: [companyPlugins.companyId, companyPlugins.pluginCode],
      set: { isEnabled, enabledVersion: MODULE_VERSION, updatedAt: new Date() },
    });
}

class ModuleRegistry {
  async listForCompany(companyId: string, database: Database = db) {
    const rows = await database
      .select()
      .from(companyPlugins)
      .where(eq(companyPlugins.companyId, companyId));
    const byCode = new Map(rows.map((row) => [row.pluginCode, row.isEnabled]));
    return FEATURE_MODULES.map((module) => ({
      code: module.code,
      name: module.name,
      description: module.description,
      icon: module.icon,
      dependencies: module.dependencies,
      isEnabled: byCode.get(module.code) ?? true,
    }));
  }

  async isEnabled(companyId: string, code: string, database: Database = db): Promise<boolean> {
    const modules = await this.listForCompany(companyId, database);
    return modules.find((module) => module.code === code)?.isEnabled ?? false;
  }

  /** Codes des modules actifs pour la société — portés par le jeton d'accès. */
  async enabledCodes(companyId: string, database: Database = db): Promise<ModuleCode[]> {
    const modules = await this.listForCompany(companyId, database);
    return modules.filter((module) => module.isEnabled).map((module) => module.code);
  }

  /** Active un module, après contrôle de ses dépendances. */
  async enableForCompany(companyId: string, code: string): Promise<void> {
    const module = requireModule(code);
    await runInTransaction(async (tx) => {
      for (const dependency of module.dependencies) {
        if (!(await this.isEnabled(companyId, dependency, tx))) {
          throw new BusinessRuleError(
            `Activez d'abord « ${moduleName(dependency)} », nécessaire pour « ${module.name} ».`,
            "MODULE_DEPENDENCY_MISSING"
          );
        }
      }
      await upsert(tx, companyId, module.code, true);
    });
  }

  /** Désactive un module, sauf si un autre module actif en dépend. */
  async disableForCompany(companyId: string, code: string): Promise<void> {
    const module = requireModule(code);
    await runInTransaction(async (tx) => {
      for (const dependent of FEATURE_MODULES) {
        if (!dependent.dependencies.includes(module.code)) continue;
        if (await this.isEnabled(companyId, dependent.code, tx)) {
          throw new BusinessRuleError(
            `Désactivez d'abord « ${dependent.name} », qui a besoin de « ${module.name} ».`,
            "MODULE_DEPENDENT_ENABLED"
          );
        }
      }
      await upsert(tx, companyId, module.code, false);
    });
  }

  /**
   * Active exactement `codes` (plus leurs dépendances) et désactive le reste, en une
   * transaction.
   */
  async applySelection(companyId: string, codes: readonly string[], tx?: Database): Promise<void> {
    const target = new Set<string>();
    const add = (code: string) => {
      const module = requireModule(code);
      if (target.has(module.code)) return;
      target.add(module.code);
      module.dependencies.forEach(add);
    };
    codes.forEach(add);

    const run = async (database: Database) => {
      for (const module of FEATURE_MODULES) {
        await upsert(database, companyId, module.code, target.has(module.code));
      }
    };
    await (tx ? run(tx) : runInTransaction(run));
  }
}

export const moduleRegistry = new ModuleRegistry();
