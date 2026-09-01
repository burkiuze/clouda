export const SIGNUP_FREE_CREDITS = Number(process.env.SIGNUP_FREE_CREDITS ?? 2000);

export const API_KEY_PREFIX = "cld_live_";

/**
 * Capabilities are opt-in per API key. Web search is deliberately absent: it
 * is always available on every key, because it is the base of the product.
 */
export const CAPABILITIES = ["research", "browse", "monitor", "citations", "social"] as const;
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
  social: {
    title: "Social & Video",
    description:
      "Açık sosyal platformlarda (Mastodon, Lemmy) arar ve YouTube video sonuçlarını getirir; elindeki video adresleri için başlık/kanal bilgisi döner.",
  },
  citations: {
    title: "Citations & Doğrulama",
    description:
      "İddiaları kaynaklarla eşler, çelişkileri işaretler ve her iddia için güven skoru üretir.",
  },
};

/**
 * Credit costs. Search is the unit of account at 2 credits, and everything
 * else is priced in multiples of it against the work it actually does — a
 * research run is many searches plus many page fetches, a browser step is one
 * fetch. The whole table moves together: pricing one operation without the
 * others would make the ratios lie about the cost.
 *
 * At this rate the 2000 free credits are about a thousand searches.
 */
export const CREDITS = {
  /** Full search: discovery across every source plus page extraction. */
  search: 2,
  /**
   * Discovery only, when the caller asked for no page content. It is most of
   * the value and a fraction of the work — no page is fetched — so charging
   * the full rate for it would be charging for work not done.
   */
  searchNoContent: 1,
  /** Charged once per research run, plus perStep for each search round. */
  researchBase: 8,
  researchPerSearch: 2,
  browseBase: 2,
  browsePerStep: 1,
  monitorCheck: 1,
  citations: 2,
  /** Social and video discovery: several APIs, no page extraction. */
  social: 2,
  /** Extraction is one fetch per URL and no discovery, so it is cheaper than search. */
  extractBase: 1,
  extractPerUrl: 1,
} as const;

/**
 * How many sources a general query fans out to, for the marketing copy.
 *
 * The source of truth is OPEN_PROVIDERS in lib/search/providers.ts; this
 * mirrors its length because importing that module into a static page would
 * pull the whole scraping stack into the build. Keep the two in step — the
 * site claimed eight while the array held seven.
 */
export const SEARCH_SOURCE_COUNT = 8;

/**
 * Publisher feeds behind the "newsroom" source, mirrored from FEEDS in
 * lib/search/newsroom.ts for the same reason. One of the eight sources above
 * is itself an aggregate of these, so the two numbers are not comparable and
 * are never added together.
 */
export const NEWS_FEED_COUNT = 22;

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
