import { useEffect, useState } from "react";

import { lastKnownOnline, onConnectivityChange, probeServer } from "@/shared/api/network";

/**
 * Connectivity state **confirmed by the server**, not just by the browser.
 * A device behind a Wi-Fi without Internet is reported offline, as it should be.
 * The periodic revalidation is shared by every caller (`network.ts`).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(lastKnownOnline);

  useEffect(() => {
    const unsubscribe = onConnectivityChange(setOnline);
    // A recent ping (less than 10 s) is reused rather than repeated.
    void probeServer().then(setOnline);
    return unsubscribe;
  }, []);

  return online;
}
