import { createHash } from "crypto";

/**
 * In-process result cache.
 *
 * This used to be a Postgres table, because the product ran as a fleet of
 * serverless instances that shared nothing and each lived for seconds. A tool
 * you run on your own machine has the opposite shape: one long-lived process,
 * no siblings to share with, and no reason to make a database a prerequisite
 * for searching the web.
 *
 * So the cache is a map with a size cap. It is lost on restart, which is the
 * correct trade — a cold start costs one slow search, while requiring Postgres
 * would cost every user an install before their first one.
 */

export interface CacheLookup {
  namespace: string;
  query: string;
  locale?: string;
  maxResults?: number;
  /** Requested freshness window in hours, if the caller set one. */
  freshnessHours?: number | null;
}

/**
 * Every field that changes the answer, encoded so that no two different
 * lookups can produce the same string.
 *
 * Joining with a separator is not enough: {namespace: "a|b", query: "c"} and
 * {namespace: "a", query: "b|c"} both flatten to "a|b|c", and would then share
 * a cache entry. Each part is length-prefixed instead, which no choice of
 * content can forge.
 *
 * Case is preserved. Lower-casing here looked harmless while the only caller
 * was a search query, but the same function keys page fetches, and a URL path
 * is case-sensitive — "/API" and "/api" are not the same document. Callers
 * that want case-insensitive matching normalise before they get here, which
 * the search engine already does.
 *
 * The freshness window is part of the key rather than only a check on the way
 * out, so a request for the last hour and one for the last week do not fight
 * over one entry.
 */
export function cacheKey(lookup: CacheLookup): string {
  const parts = [
    lookup.namespace,
    lookup.query.trim().replace(/\s+/g, " "),
    lookup.locale ?? "",
    String(lookup.maxResults ?? ""),
    lookup.freshnessHours == null ? "-" : String(lookup.freshnessHours),
  ];
  const encoded = parts.map((part) => `${part.length}:${part}`).join("");
  return createHash("sha256").update(encoded).digest("hex");
}

export interface CacheHit<T> {
  payload: T;
  ageSeconds: number;
}

interface Entry {
  payload: unknown;
  storedAt: number;
  expiresAt: number;
  /** The window this entry was produced under, for the freshness contract. */
  freshnessHours: number | null;
}

/**
 * Entries, not bytes. A search response is a few kilobytes and a news corpus
 * is a few hundred, so a thousand entries is tens of megabytes in the worst
 * case and far less in practice.
 */
const MAX_ENTRIES = 1000;

const store = new Map<string, Entry>();

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Map preserves insertion order, and every read reinserts, so the first key
  // is the least recently used.
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export async function cacheGet<T>(lookup: CacheLookup): Promise<CacheHit<T> | null> {
  const key = cacheKey(lookup);
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  // The window is in the key, so the only remaining question is whether this
  // entry has itself aged past it.
  if (lookup.freshnessHours != null) {
    const ageHours = (Date.now() - entry.storedAt) / 3_600_000;
    if (ageHours > lookup.freshnessHours) return null;
  }

  // Refresh recency for the eviction order above.
  store.delete(key);
  store.set(key, entry);

  return {
    payload: entry.payload as T,
    ageSeconds: Math.round((Date.now() - entry.storedAt) / 1000),
  };
}

export async function cacheSet<T>(
  lookup: CacheLookup,
  payload: T,
  ttlSeconds: number,
  /**
   * Accepted and ignored. It meant "do not make the caller wait on the
   * database write"; with the store in memory there is no write to wait on,
   * and the flag stays in the signature so callers need not care which
   * implementation they are talking to.
   */
  _options?: { background?: boolean }
): Promise<void> {
  const key = cacheKey(lookup);
  store.delete(key);
  store.set(key, {
    payload,
    storedAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000,
    freshnessHours: lookup.freshnessHours ?? null,
  });
  evictIfNeeded();
}

/** Drops cached answers for a query, or everything expired when omitted. */
export async function cacheInvalidate(lookup?: Partial<CacheLookup>): Promise<number> {
  if (lookup?.namespace && lookup.query) {
    return store.delete(cacheKey(lookup as CacheLookup)) ? 1 : 0;
  }

  let dropped = 0;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

export function cacheStats(): { entries: number; maxEntries: number } {
  return { entries: store.size, maxEntries: MAX_ENTRIES };
}

/**
 * TTL policy: volatile subjects expire quickly, reference material lasts.
 * Returns seconds.
 */
export function ttlForIntent(intent: string, freshnessHours?: number | null): number {
  const byIntent = (() => {
    switch (intent) {
      case "news":
      case "finance":
        return 5 * 60;
      case "product":
        return 30 * 60;
      case "technical":
      case "academic":
        return 24 * 3600;
      default:
        return 3600;
    }
  })();

  if (freshnessHours == null) return byIntent;

  // Whichever expires first wins, and both reasons are real. A caller asking
  // for the last four seconds must not be served a minute-old answer, so there
  // is no floor. And asking for a twenty-four hour window does not make a news
  // result keep for twenty-four hours — the subject moves whatever window the
  // question used.
  return Math.min(byIntent, freshnessHours * 3600, 6 * 3600);
}
