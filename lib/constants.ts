export const SIGNUP_FREE_CREDITS = Number(process.env.SIGNUP_FREE_CREDITS ?? 2000);

export const API_KEY_PREFIX = "cld_live_";

/**
 * Capabilities are opt-in per API key. Web search is deliberately absent: it
 * is always available on every key, because it is the base of the product.
 */
export const CAPABILITIES = ["research", "browse", "monitor", "citations"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, { title: string; description: string }> = {
  research: {
    title: "Deep Research",
    description:
      "Soruyu alt sorulara böler, çok turlu arama yapar, kaynakları karşılaştırır ve kaynaklı rapor üretir.",
  },
  browse: {
    title: "Browser Agent",
    description:
      "Sayfaları açar, bağlantıları takip eder, sayfalama yapar ve sayfa içinde bilgi arar.",
  },
  monitor: {
    title: "Web Monitoring",
    description: "URL ya da arama sorgusunu izler, değişiklikte webhook ile bildirir.",
  },
  citations: {
    title: "Citations & Doğrulama",
    description:
      "İddiaları kaynaklarla eşler, çelişkileri işaretler ve her iddia için güven skoru üretir.",
  },
};

/**
 * Credit costs. Search is the unit of account; the heavier operations are
 * priced against the work they actually do (a research run is many searches
 * plus many page fetches, a browser step is one fetch).
 */
export const CREDITS = {
  search: 10,
  /** Charged once per research run, plus perStep for each search round. */
  researchBase: 40,
  researchPerSearch: 10,
  browseBase: 10,
  browsePerStep: 5,
  monitorCheck: 5,
  citations: 10,
  /** Extraction is one fetch per URL and no discovery, so it is cheaper than search. */
  extractBase: 2,
  extractPerUrl: 3,
} as const;

/** Backwards-compatible alias used by the dashboard and marketing copy. */
export const CREDITS_PER_SEARCH = CREDITS.search;

export const RESEARCH_DEPTHS = {
  quick: { rounds: 1, subQuestions: 3, maxSources: 10 },
  standard: { rounds: 2, subQuestions: 5, maxSources: 20 },
  deep: { rounds: 3, subQuestions: 8, maxSources: 40 },
} as const;

export type ResearchDepth = keyof typeof RESEARCH_DEPTHS;

/** Freshness windows callers may ask for, in hours. */
export const FRESHNESS_WINDOWS: Record<string, number> = {
  hour: 1,
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
  year: 24 * 365,
};
