import { useEffect, useState } from "react";

import { lastKnownOnline, onConnectivityChange, probeServer } from "@/shared/api/network";

/**
 * État de connectivité **confirmé par le serveur**, pas seulement par le navigateur.
 * Un poste derrière un Wi-Fi sans Internet est signalé hors ligne, comme il se doit.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(lastKnownOnline);

  useEffect(() => {
    const unsubscribe = onConnectivityChange(setOnline);
    void probeServer(true).then(setOnline);
    // Revalidation périodique : une coupure survenue sans événement navigateur
    // (câble débranché côté box) doit finir par être détectée.
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
