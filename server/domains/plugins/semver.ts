/**
 * Comparaison SemVer minimale pour la compatibilité noyau ⇄ module ([FR-PLUG-8]).
 *
 * Portée volontairement réduite aux formes utilisées par les manifestes : `1.2.3`,
 * `^1.2.3`, `~1.2.3`, `>=1.2.3` et `*`. Ajouter une dépendance complète pour cinq
 * opérateurs serait disproportionné.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(value: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Vrai si `version` satisfait `range`. Un range non reconnu est refusé, jamais toléré. */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  const current = parseSemVer(version);
  if (!current) return false;

  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
  if (!operator) return false;
  const target = parseSemVer(operator[2]);
  if (!target) return false;

  switch (operator[1]) {
    case "^":
      // Compatible tant que le majeur ne change pas (majeur 0 : le mineur fait foi).
      return target.major === 0
        ? current.major === 0 &&
            current.minor === target.minor &&
            compareSemVer(current, target) >= 0
        : current.major === target.major && compareSemVer(current, target) >= 0;
    case "~":
      return (
        current.major === target.major &&
        current.minor === target.minor &&
        compareSemVer(current, target) >= 0
      );
    case ">=":
      return compareSemVer(current, target) >= 0;
    case "<=":
      return compareSemVer(current, target) <= 0;
    case ">":
      return compareSemVer(current, target) > 0;
    case "<":
      return compareSemVer(current, target) < 0;
    case "=":
    case undefined:
      return compareSemVer(current, target) === 0;
    default:
      return false;
  }
}
