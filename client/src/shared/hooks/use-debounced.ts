import { useEffect, useState } from "react";

/**
 * Debounced value — used by every search field.
 * Without it, each keystroke would trigger a server request and, on a slow link,
 * the display would jump around as responses arrive out of order.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
