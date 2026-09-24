/**
 * Translated labels for catalog data shared with the server (modules, presets, system
 * roles, permissions).
 *
 * `shared/modules-catalog.ts` and `shared/rbac.ts` hold the English source text; the
 * UI looks the translation up by code and falls back to the stored text when no
 * translation exists (e.g. a custom role created by the company).
 *
 * These helpers call `i18n.t` at call time: components using them must subscribe to
 * language changes with `useTranslation()` (every page does already).
 */

import { FEATURE_MODULES, MODULE_PRESETS } from "@shared/modules-catalog";
import { PERMISSIONS } from "@shared/rbac";
import { i18n } from "@/shared/i18n";

function translateOr(key: string, fallback: string): string {
  return i18n.exists(key) ? i18n.t(key) : fallback;
}

/** Translated name of a feature module (`modules:<code>.name`). */
export function moduleName(code: string): string {
  const fallback = FEATURE_MODULES.find((feature) => feature.code === code)?.name ?? code;
  return translateOr(`modules:${code}.name`, fallback);
}

/** Translated one-sentence description of a feature module. */
export function moduleDescription(code: string, fallback = ""): string {
  const source = FEATURE_MODULES.find((feature) => feature.code === code)?.description ?? fallback;
  return translateOr(`modules:${code}.description`, source);
}

/** Translated name of a module preset (usage level). */
export function presetName(code: string): string {
  const fallback = MODULE_PRESETS.find((preset) => preset.code === code)?.name ?? code;
  return translateOr(`modules:presets.${code}.name`, fallback);
}

/** Translated description of a module preset. */
export function presetDescription(code: string): string {
  const fallback = MODULE_PRESETS.find((preset) => preset.code === code)?.description ?? "";
  return translateOr(`modules:presets.${code}.description`, fallback);
}

/** Translated label of a permission code (`roles:permissions.<code>`). */
export function permissionLabel(code: string): string {
  const fallback = (PERMISSIONS as Record<string, string>)[code] ?? code;
  return translateOr(`roles:permissions.${code}`, fallback);
}

interface RoleLike {
  slug?: string | null;
  name: string;
  description?: string | null;
  isSystem?: boolean;
}

/** Name of a role: translated for system roles, as stored for company roles. */
export function roleName(role: RoleLike): string {
  if (!role.isSystem || !role.slug) return role.name;
  return translateOr(`roles:system.${role.slug}.name`, role.name);
}

/** Description of a role: translated for system roles, as stored for company roles. */
export function roleDescription(role: RoleLike): string {
  const stored = role.description ?? "";
  if (!role.isSystem || !role.slug) return stored;
  return translateOr(`roles:system.${role.slug}.description`, stored);
}
