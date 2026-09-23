/** Limitation de débit — priorité à l'authentification [NFR-SEC-4]. */

import rateLimit from "express-rate-limit";

const disabled = process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true";

const baseOptions = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  skip: () => disabled,
  message: {
    error: "Trop de requêtes. Réessayez dans un instant.",
    code: "RATE_LIMITED",
  },
};

/** Connexion : fenêtre courte et quota bas pour contrer le bourrage d'identifiants. */
export const authRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 20,
});

export const apiRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 600,
});

/**
 * Synchronisation : quota élevé et fenêtre large. Un poste qui revient après une
 * longue coupure remonte plusieurs lots d'affilée ; le brider reviendrait à retarder
 * la convergence des données, ce qui est exactement ce qu'on cherche à éviter.
 */
export const syncRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 240,
});
