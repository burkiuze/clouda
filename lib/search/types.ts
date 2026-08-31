/** Shared shapes for discovery, scoring and enrichment. */

export interface RawResult {
  title: string;
  url: string;
  snippet: string;
  /** Publication date reported by the provider, when it gives one. */
  publishedAt?: string | null;
}

export interface SearchResult extends RawResult {
  /** Readable page text, filled in by the enrichment pass. */
  content: string;
  publishedAt: string | null;
  updatedAt?: string | null;
  scores: QualityScores;
  /** Provider that surfaced this result. */
  source: string;
}

export interface QualityScores {
  /** 0-1, term overlap and position of the query in title/snippet/content. */
  relevance: number;
  /** 0-1, domain authority class and page signals. */
  credibility: number;
  /** 0-1, decays with the age of the content. */
  freshness: number;
  /** 0-1, weighted blend of the three above. */
  overall: number;
  /** Why the credibility score came out where it did. */
  signals: string[];
}

export type QueryIntent =
  | "news"
  | "finance"
  | "product"
  | "academic"
  | "technical"
  | "general";

export interface QueryPlan {
  original: string;
  /** Query actually sent to providers, after cleanup. */
  optimized: string;
  intent: QueryIntent;
  /** Whether the question implies "right now" and should skip stale caches. */
  needsFreshness: boolean;
  /** Suggested freshness window in hours, when the intent implies one. */
  suggestedFreshnessHours: number | null;
  /** Decomposition for research; a single-item list for a simple lookup. */
  subQueries: string[];
  language: string;
}

export interface SearchOptions {
  maxResults?: number;
  locale?: string;
  freshnessHours?: number | null;
  /** Skip the readable-content fetch when the caller only needs links. */
  includeContent?: boolean;
  /** Bypass the cache entirely. */
  noCache?: boolean;
  domainPolicy?: { allowedDomains?: string[]; blockedDomains?: string[] };
}

export interface SearchResponse {
  query: string;
  plan: QueryPlan;
  results: SearchResult[];
  provider: string;
  cacheHit: boolean;
  tookMs: number;
  /** Providers that were tried and failed, for transparency. */
  degraded: { provider: string; reason: string }[];
}
