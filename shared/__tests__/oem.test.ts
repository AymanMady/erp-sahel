/** Normalisation OEM et fermeture transitive des équivalences ([BR-5], [FR-XREF-2]). */

import { describe, expect, it } from "vitest";

import { canonicalPair, isRedundantEquivalence, normalizeOem, resolveEquivalents } from "../oem";

describe("normalisation des références", () => {
  it("ignore casse, espaces et ponctuation", () => {
    expect(normalizeOem("90915-YZZD3")).toBe("90915YZZD3");
    expect(normalizeOem(" 90915 yzzd3 ")).toBe("90915YZZD3");
    expect(normalizeOem("90915.YZZD3")).toBe("90915YZZD3");
    expect(normalizeOem("90915/yzzd3")).toBe("90915YZZD3");
  });

  it("ordonne une paire de façon déterministe", () => {
    expect(canonicalPair("B-2", "A-1")).toEqual(canonicalPair("A-1", "B-2"));
  });
});

describe("classe d'équivalence", () => {
  const edges = [
    { normA: normalizeOem("90915-10004"), normB: normalizeOem("90915-YZZD3") },
    { normA: normalizeOem("90915-YZZD3"), normB: normalizeOem("90915-YZZE1") },
    { normA: normalizeOem("90915-YZZE1"), normB: normalizeOem("90915-30002") },
  ];

  it("est transitive quel que soit le point d'entrée", () => {
    const fromStart = resolveEquivalents("90915-10004", edges).sort();
    const fromEnd = resolveEquivalents("90915-30002", edges).sort();
    const fromMiddle = resolveEquivalents("90915-YZZE1", edges).sort();

    expect(fromStart).toEqual(fromEnd);
    expect(fromStart).toEqual(fromMiddle);
    expect(fromStart).toHaveLength(4);
  });

  it("est symétrique : l'ordre de déclaration n'a pas d'incidence", () => {
    const reversed = edges.map((edge) => ({ normA: edge.normB, normB: edge.normA }));
    expect(resolveEquivalents("90915-10004", reversed).sort()).toEqual(
      resolveEquivalents("90915-10004", edges).sort()
    );
  });

  it("renvoie la référence seule quand aucune équivalence n'existe", () => {
    expect(resolveEquivalents("00000-ZZZ", edges)).toEqual([normalizeOem("00000-ZZZ")]);
  });

  it("détecte une équivalence déjà impliquée par transitivité", () => {
    expect(isRedundantEquivalence("90915-10004", "90915-30002", edges)).toBe(true);
    expect(isRedundantEquivalence("90915-10004", "11111-AAA", edges)).toBe(false);
  });

  it("borne la taille de la classe pour ne pas boucler sur un graphe pathologique", () => {
    const dense = Array.from({ length: 50 }, (_, index) => ({
      normA: `REF${index}`,
      normB: `REF${index + 1}`,
    }));
    expect(resolveEquivalents("REF0", dense, { maxSize: 10 })).toHaveLength(10);
  });
});
