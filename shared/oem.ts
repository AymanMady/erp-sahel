/**
 * Références OEM : normalisation et fermeture transitive des équivalences
 * ([BR-5], [FR-XREF-2], [FR-SRCH-4]).
 *
 * Partagé client ⇄ serveur pour que la recherche hors-ligne du POS retrouve **les mêmes**
 * équivalences que la recherche en ligne.
 */

/**
 * Forme canonique d'une référence : majuscules, sans espaces, tirets, points ni slashes.
 * `90915-YZZD3`, `90915 yzzd3` et `90915.YZZD3` se rapprochent donc tous sur `90915YZZD3`.
 */
export function normalizeOem(reference: string | null | undefined): string {
  return String(reference ?? "")
    .toUpperCase()
    .replace(/[\s\-._/\\]/g, "");
}

/** Une arête d'équivalence, telle que stockée (`norm_a` ↔ `norm_b`). */
export interface EquivalenceEdge {
  normA: string;
  normB: string;
}

/**
 * Classe d'équivalence complète d'une référence : parcours en largeur du graphe
 * **non orienté** des équivalences, donc symétrique et transitif par construction.
 *
 * La borne `maxSize` protège d'un graphe pathologique (import massif mal formé) :
 * une classe de plusieurs milliers de références traduit une donnée erronée, pas un
 * besoin métier — on tronque plutôt que de faire tourner la recherche indéfiniment.
 */
export function resolveEquivalents(
  reference: string,
  edges: readonly EquivalenceEdge[],
  options: { maxSize?: number } = {}
): string[] {
  const maxSize = options.maxSize ?? 500;
  const start = normalizeOem(reference);
  if (!start) return [];

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const edge of edges) {
    link(edge.normA, edge.normB);
    link(edge.normB, edge.normA);
  }

  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0 && visited.size < maxSize) {
    const current = queue.shift()!;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return [...visited];
}

/**
 * Détecte si ajouter `a ↔ b` créerait une équivalence déjà impliquée par transitivité
 * — inutile, et source de graphes denses [FR-XREF-4].
 */
export function isRedundantEquivalence(
  refA: string,
  refB: string,
  edges: readonly EquivalenceEdge[]
): boolean {
  const a = normalizeOem(refA);
  const b = normalizeOem(refB);
  if (!a || !b) return false;
  if (a === b) return true;
  return resolveEquivalents(a, edges).includes(b);
}

/** Ordonne une paire pour que `(a,b)` et `(b,a)` produisent la même ligne unique. */
export function canonicalPair(refA: string, refB: string): { normA: string; normB: string } {
  const a = normalizeOem(refA);
  const b = normalizeOem(refB);
  return a <= b ? { normA: a, normB: b } : { normA: b, normB: a };
}
