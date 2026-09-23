import { useEffect, useState } from "react";

/**
 * Valeur retardée — utilisée par tous les champs de recherche.
 * Sans elle, chaque frappe déclencherait une requête serveur et, sur une liaison
 * lente, l'affichage sauterait au rythme des réponses qui arrivent dans le désordre.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
