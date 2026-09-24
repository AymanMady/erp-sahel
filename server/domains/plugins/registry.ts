/**
 * Registre des modules : découverte, validation et cycle de vie ([FR-PLUG-5]).
 *
 * L'enregistrement se fait au démarrage depuis le point de composition ; la validation
 * refuse un module dont les dépendances manquent ou dont la version de noyau exigée
 * n'est pas satisfaite ([FR-PLUG-8]).
 */

import { and, eq } from "drizzle-orm";

import type { ModuleCode } from "@shared/schema";
import { companyPlugins, installedPlugins } from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { logger } from "../../shared/logging/logger";
import type { ErpPlugin } from "./contract";
import { satisfiesRange } from "./semver";

/** Version du noyau ERP — comparée à `coreVersion` de chaque module. */
export const CORE_VERSION = "1.0.0";

class PluginRegistry {
  private readonly plugins = new Map<ModuleCode, ErpPlugin>();

  register(plugin: ErpPlugin): void {
    const { code, coreVersion } = plugin.meta;
    if (this.plugins.has(code)) {
      throw new Error(`Module « ${code} » déjà enregistré.`);
    }
    if (!satisfiesRange(CORE_VERSION, coreVersion)) {
      throw new Error(
        `Module « ${code} » incompatible : exige un noyau ${coreVersion}, celui-ci est ${CORE_VERSION}.`
      );
    }
    this.plugins.set(code, plugin);
    logger.info("Module enregistré", { code, version: plugin.meta.version });
  }

  /** Vérifie que toutes les dépendances déclarées sont présentes (aucun cycle possible). */
  validate(): void {
    for (const plugin of this.plugins.values()) {
      for (const dependency of plugin.meta.dependencies) {
        if (!this.plugins.has(dependency)) {
          throw new Error(
            `Module « ${plugin.meta.code} » dépend de « ${dependency} », absent du registre.`
          );
        }
        if (this.plugins.get(dependency)?.meta.dependencies.includes(plugin.meta.code)) {
          throw new Error(
            `Dépendance circulaire entre « ${plugin.meta.code} » et « ${dependency} ».`
          );
        }
      }
    }
  }

  list(): ErpPlugin[] {
    return [...this.plugins.values()];
  }

  get(code: string): ErpPlugin | undefined {
    return this.plugins.get(code as ModuleCode);
  }

  require(code: string): ErpPlugin {
    const plugin = this.get(code);
    if (!plugin) throw new NotFoundError(`Module « ${code} » inconnu.`);
    return plugin;
  }

  /** Extension de profil produit servant un type de profil donné. */
  profileExtensionFor(profileType: string) {
    return this.list().find((plugin) => plugin.productProfile?.profileType === profileType)
      ?.productProfile;
  }

  /** Installe (ou met à jour) tous les modules enregistrés — idempotent. */
  async installAll(): Promise<void> {
    await runInTransaction(async (tx) => {
      for (const plugin of this.list()) {
        await tx
          .insert(installedPlugins)
          .values({
            code: plugin.meta.code,
            version: plugin.meta.version,
            coreVersion: plugin.meta.coreVersion,
            status: "INSTALLED",
          })
          .onConflictDoUpdate({
            target: installedPlugins.code,
            set: {
              version: plugin.meta.version,
              coreVersion: plugin.meta.coreVersion,
              updatedAt: new Date(),
            },
          });
        await plugin.install?.(tx);
      }
    });
  }

  /** Active un module pour une société, après contrôle des dépendances ([BR-19]). */
  async enableForCompany(companyId: string, code: string, tx?: Database): Promise<void> {
    const plugin = this.require(code);
    const run = async (database: Database) => {
      for (const dependency of plugin.meta.dependencies) {
        const enabled = await this.isEnabled(companyId, dependency, database);
        if (!enabled) {
          throw new BusinessRuleError(
            `Activez d'abord le module « ${dependency} », requis par « ${code} ».`,
            "MODULE_DEPENDENCY_MISSING"
          );
        }
      }
      await database
        .insert(companyPlugins)
        .values({
          companyId,
          pluginCode: plugin.meta.code,
          isEnabled: true,
          enabledVersion: plugin.meta.version,
        })
        .onConflictDoUpdate({
          target: [companyPlugins.companyId, companyPlugins.pluginCode],
          set: { isEnabled: true, enabledVersion: plugin.meta.version, updatedAt: new Date() },
        });
      await plugin.enable?.(database, companyId);
    };
    await (tx ? run(tx) : runInTransaction(run));
  }

  /** Désactive un module : les données restent en base, seuls les accès sont coupés. */
  async disableForCompany(companyId: string, code: string): Promise<void> {
    const plugin = this.require(code);
    const dependents = this.list().filter((candidate) =>
      candidate.meta.dependencies.includes(plugin.meta.code)
    );
    await runInTransaction(async (tx) => {
      for (const dependent of dependents) {
        if (await this.isEnabled(companyId, dependent.meta.code, tx)) {
          throw new BusinessRuleError(
            `Désactivez d'abord « ${dependent.meta.code} », qui dépend de « ${code} ».`,
            "MODULE_DEPENDENT_ENABLED"
          );
        }
      }
      // Insertion plutôt que simple mise à jour : une fonctionnalité active par défaut
      // n'a pas encore de ligne, et doit pourtant pouvoir être désactivée.
      await tx
        .insert(companyPlugins)
        .values({
          companyId,
          pluginCode: plugin.meta.code,
          isEnabled: false,
          enabledVersion: plugin.meta.version,
        })
        .onConflictDoUpdate({
          target: [companyPlugins.companyId, companyPlugins.pluginCode],
          set: { isEnabled: false, updatedAt: new Date() },
        });
      await plugin.disable?.(tx, companyId);
    });
  }

  /**
   * État effectif : la ligne `company_plugins` si la société a déjà basculé le module,
   * sinon l'état par défaut du module (`defaultEnabled`).
   */
  async isEnabled(companyId: string, code: string, database: Database = db): Promise<boolean> {
    const [row] = await database
      .select({ isEnabled: companyPlugins.isEnabled })
      .from(companyPlugins)
      .where(and(eq(companyPlugins.companyId, companyId), eq(companyPlugins.pluginCode, code)))
      .limit(1);
    return row ? row.isEnabled : Boolean(this.get(code)?.meta.defaultEnabled);
  }

  /** Codes des modules actifs pour la société — portés par le jeton d'accès. */
  async enabledCodes(companyId: string, database: Database = db): Promise<ModuleCode[]> {
    const modules = await this.listForCompany(companyId, database);
    return modules.filter((module) => module.isEnabled).map((module) => module.code);
  }

  async listForCompany(companyId: string, database: Database = db) {
    const rows = await database
      .select()
      .from(companyPlugins)
      .where(eq(companyPlugins.companyId, companyId));
    const byCode = new Map(rows.map((row) => [row.pluginCode, row]));
    return this.list().map((plugin) => {
      const row = byCode.get(plugin.meta.code);
      return {
        ...plugin.meta,
        permissions: plugin.permissions,
        navigation: plugin.navigation,
        searchCriteria: plugin.searchCriteria,
        isEnabled: row ? row.isEnabled : plugin.meta.defaultEnabled,
        enabledVersion: row?.enabledVersion ?? null,
      };
    });
  }

  /**
   * Applique un type d'activité : active exactement `codes` (plus leurs dépendances)
   * et désactive le reste, en une transaction. Les données ne sont jamais supprimées.
   */
  async applySelection(companyId: string, codes: readonly string[]): Promise<void> {
    const target = new Set<ModuleCode>();
    const add = (code: string) => {
      const plugin = this.require(code);
      if (target.has(plugin.meta.code)) return;
      target.add(plugin.meta.code);
      plugin.meta.dependencies.forEach(add);
    };
    codes.forEach(add);

    await runInTransaction(async (tx) => {
      const current = new Map(
        (await this.listForCompany(companyId, tx)).map((module) => [module.code, module.isEnabled])
      );
      for (const plugin of this.list()) {
        const enable = target.has(plugin.meta.code);
        await tx
          .insert(companyPlugins)
          .values({
            companyId,
            pluginCode: plugin.meta.code,
            isEnabled: enable,
            enabledVersion: plugin.meta.version,
          })
          .onConflictDoUpdate({
            target: [companyPlugins.companyId, companyPlugins.pluginCode],
            set: { isEnabled: enable, enabledVersion: plugin.meta.version, updatedAt: new Date() },
          });
        if (current.get(plugin.meta.code) === enable) continue;
        await (enable ? plugin.enable?.(tx, companyId) : plugin.disable?.(tx, companyId));
      }
    });
  }
}

export const pluginRegistry = new PluginRegistry();
