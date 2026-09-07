export type SearchDepth = "fast" | "balanced" | "deep";

/** Explicit latency/coverage choices; no hidden claim of exhaustive search. */
export const SEARCH_PROFILES = {
  fast: { primarySources: 3, fallbackDelayMs: 80, webMs: 450, verticalMs: 350,
    recoveryMs: 700, enrichMs: 1000, maxFetches: 3 },
  balanced: { primarySources: 4, fallbackDelayMs: 120, webMs: 700, verticalMs: 600,
    recoveryMs: 1200, enrichMs: 1400, maxFetches: 5 },
  deep: { primarySources: Infinity, fallbackDelayMs: 0, webMs: 1800, verticalMs: 1600,
    recoveryMs: 2500, enrichMs: 3500, maxFetches: 8 },
} as const;
