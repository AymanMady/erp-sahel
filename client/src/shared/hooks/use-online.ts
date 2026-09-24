import { useEffect, useState } from "react";

import { lastKnownOnline, onConnectivityChange, probeServer } from "@/shared/api/network";

/**
 * Connectivity state **confirmed by the server**, not just by the browser.
 * A device behind a Wi-Fi without Internet is reported offline, as it should be.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(lastKnownOnline);

  useEffect(() => {
    const unsubscribe = onConnectivityChange(setOnline);
    void probeServer(true).then(setOnline);
    // Periodic revalidation: an outage that happened without a browser event
    // (cable unplugged on the router side) must eventually be detected.
    const timer = window.setInterval(() => {
      void probeServer(true).then(setOnline);
    }, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  return online;
}
