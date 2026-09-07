/**
 * Values the UI and the docs read.
 *
 * What used to live here — free-credit grants, an API key prefix, per-key
 * capabilities and a price for every operation — described a metered service.
 * A tool you run yourself meters nothing and grants you everything.
 */

/**
 * How many sources a general query fans out to, for the marketing copy.
 *
 * The source of truth is OPEN_PROVIDERS in lib/search/providers.ts; this
 * mirrors its length because importing that module into a static page would
 * pull the whole scraping stack into the build. Keep the two in step — the
 * site claimed eight while the array held seven.
 */
export const SEARCH_SOURCE_COUNT = 9;

/**
 * Distinct third-party endpoints a query can reach across every intent.
 *
 * Larger than SEARCH_SOURCE_COUNT because two of the sources are themselves
 * groups: "packages" asks five registries and "scholar" asks three indexes,
 * merged before they reach the fan-out so five registries cost one slot in it.
 * Counted honestly: nine general sources, plus OpenAlex, MDN and SEC full-text
 * search, plus those eight grouped ones.
 */
export const TOTAL_SOURCE_COUNT = 20;

/**
 * Publisher feeds behind the "newsroom" source, mirrored from FEEDS in
 * lib/search/newsroom.ts for the same reason. One of the eight sources above
 * is itself an aggregate of these, so the two numbers are not comparable and
 * are never added together.
 */
export const NEWS_FEED_COUNT = 22;

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
