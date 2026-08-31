import { cacheGet, cacheSet, ttlForIntent } from "@/lib/core/cache";
import { CloudaError } from "@/lib/core/errors";
import { filterUnsafe } from "@/lib/search/safety";
import { fetchAndExtract } from "@/lib/search/extract";
import { planQuery } from "@/lib/search/query";
import { scoreResult } from "@/lib/search/scoring";
import {
  configuredKeyedProvider,
  KEYED_PROVIDERS,
  openProvidersForIntent,
  Provider,
} from "@/lib/search/providers";
import type {
  QueryPlan,
  RawResult,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";

export const DEFAULT_LOCALE = "tr-TR";

/**
 * The search pipeline, in four stages:
 *
 *   plan       classify intent, clean the query, decide on freshness
 *   discover   keyed provider first, then the open providers merged together;
 *              every failure is recorded rather than swallowed
 *   enrich     fetch each result and extract readable text plus real dates
 *   score      attach relevance/credibility/freshness/overall and re-rank
 *
 * Results are cached by normalised query, with the freshness window part of
 * the cache contract so a "last hour" request never gets a day-old row.
 */

const MAX_ENRICH_CONCURRENCY = 8;

/**
 * Providers are asked for more than the caller wants. Deduplication, the
 * relevance gate and the freshness window all discard candidates, so a thin
 * request would otherwise return fewer results than asked for.
 */
const CANDIDATE_MULTIPLIER = 2;
const MIN_CANDIDATES = 10;

/** Interleaves several providers' results so no single source dominates. */
function mergeRoundRobin(lists: RawResult[][], limit: number): RawResult[] {
  const merged: RawResult[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...lists.map((l) => l.length));

  for (let rank = 0; rank < depth && merged.length < limit; rank++) {
    for (const list of lists) {
      if (merged.length >= limit) break;
      const item = list[rank];
      if (!item) continue;
      const key = item.url.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

/** Drops open-source results that share no meaningful term with the query. */
function relevanceGate(results: RawResult[], plan: QueryPlan): RawResult[] {
  const terms = plan.optimized
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .map((t) => t.slice(0, Math.max(4, t.length - 2)));

  if (terms.length === 0) return results;

  return results.filter((r) => {
    const hay = `${r.title} ${r.snippet}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
}

interface DiscoveryOutcome {
  results: RawResult[];
  provider: string;
  degraded: { provider: string; reason: string }[];
}

async function runProvider(
  provider: Provider,
  query: string,
  limit: number,
  locale: string,
  freshnessHours: number | null | undefined,
  degraded: { provider: string; reason: string }[]
): Promise<RawResult[]> {
  try {
    const results = await provider.search(query, limit, locale, freshnessHours);
    if (results.length === 0) {
      degraded.push({ provider: provider.name, reason: "no_results" });
    }
    return results;
  } catch (err) {
    degraded.push({
      provider: provider.name,
      reason: err instanceof Error ? err.message.slice(0, 120) : "failed",
    });
    return [];
  }
}

async function discover(
  plan: QueryPlan,
  limit: number,
  locale: string,
  freshnessHours: number | null | undefined
): Promise<DiscoveryOutcome> {
  const degraded: { provider: string; reason: string }[] = [];

  // A configured provider is the dependable path; try each in turn.
  for (const provider of KEYED_PROVIDERS) {
    if (!provider.available()) continue;
    const results = await runProvider(provider, plan.optimized, limit, locale, freshnessHours, degraded);
    const safe = filterUnsafe(results);
    if (safe.length > 0) return { results: safe, provider: provider.name, degraded };
  }

  // Otherwise fan out across the open providers that suit this intent.
  const open = openProvidersForIntent(plan.intent);
  const settled = await Promise.all(
    open.map(async (provider) => ({
      name: provider.name,
      results: filterUnsafe(
        await runProvider(provider, plan.optimized, limit, locale, freshnessHours, degraded)
      ),
    }))
  );

  const answered = settled.filter((s) => s.results.length > 0);
  if (answered.length === 0) return { results: [], provider: "none", degraded };

  // Open indexes match loosely, so gate on shared terms before merging.
  const gated = answered
    .map((s) => ({ name: s.name, results: relevanceGate(s.results, plan) }))
    .filter((s) => s.results.length > 0);

  const chosen = gated.length > 0 ? gated : answered;

  return {
    results: mergeRoundRobin(chosen.map((s) => s.results), limit),
    provider: chosen.map((s) => s.name).join("+"),
    degraded,
  };
}

/** Fetches page content for results, bounded so one slow host can't stall. */
async function enrich(
  results: RawResult[],
  options: SearchOptions
): Promise<{ raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null }[]> {
  const out: { raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null }[] = [];

  for (let i = 0; i < results.length; i += MAX_ENRICH_CONCURRENCY) {
    const batch = results.slice(i, i + MAX_ENRICH_CONCURRENCY);
    const pages = await Promise.all(
      batch.map(async (raw) => {
        if (options.includeContent === false) {
          return { raw, content: "", updatedAt: null, publishedAt: raw.publishedAt ?? null };
        }
        const page = await fetchAndExtract(raw.url, { policy: options.domainPolicy });
        return {
          raw,
          content: page?.content ?? raw.snippet,
          updatedAt: page?.updatedAt ?? null,
          // A date from the page itself beats the provider's guess.
          publishedAt: page?.publishedAt ?? raw.publishedAt ?? null,
        };
      })
    );
    out.push(...pages);
  }

  return out;
}

/** Counts how many distinct hosts back the same headline-ish claim. */
function corroborationByHost(results: RawResult[]): Map<string, number> {
  const hosts = new Map<string, number>();
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
    } catch {
      // ignore
    }
  }
  return hosts;
}

export async function searchWeb(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const started = Date.now();
  const trimmed = query.trim();
  if (!trimmed) throw new CloudaError("invalid_request", "Sorgu boş olamaz.");
  if (trimmed.length > 400) throw new CloudaError("query_too_long", "Sorgu 400 karakteri aşamaz.");

  const maxResults = Math.min(Math.max(options.maxResults ?? 10, 1), 30);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const plan = planQuery(trimmed, { freshnessHours: options.freshnessHours });
  const freshnessHours = options.freshnessHours ?? plan.suggestedFreshnessHours;

  const lookup = {
    namespace: "search",
    query: plan.optimized,
    locale,
    maxResults,
    freshnessHours,
  };

  if (!options.noCache) {
    const hit = await cacheGet<SearchResponse>(lookup);
    if (hit) {
      return { ...hit.payload, cacheHit: true, tookMs: Date.now() - started };
    }
  }

  const candidateCount = Math.max(MIN_CANDIDATES, maxResults * CANDIDATE_MULTIPLIER);
  const {
    results: candidates,
    provider,
    degraded,
  } = await discover(plan, candidateCount, locale, freshnessHours);
  const raw = candidates.slice(0, maxResults);

  if (raw.length === 0) {
    return {
      query: trimmed,
      plan,
      results: [],
      provider,
      cacheHit: false,
      tookMs: Date.now() - started,
      degraded,
    };
  }

  const enriched = await enrich(raw, options);
  const hostCounts = corroborationByHost(raw);

  let results: SearchResult[] = enriched.map((item) => {
    let host = "";
    try {
      host = new URL(item.raw.url).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }

    return {
      title: item.raw.title,
      url: item.raw.url,
      snippet: item.raw.snippet,
      content: item.content,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      source: provider,
      scores: scoreResult({
        query: plan.optimized,
        intent: plan.intent,
        result: { ...item.raw, publishedAt: item.publishedAt },
        content: item.content,
        corroboration: hostCounts.get(host) ?? 1,
      }),
    };
  });

  // Honour an explicit freshness window by dropping provably older content.
  if (freshnessHours != null) {
    const cutoff = Date.now() - freshnessHours * 3_600_000;
    const withinWindow = results.filter((r) => {
      if (!r.publishedAt) return true; // unknown date: keep, scored neutral
      const ts = Date.parse(r.publishedAt);
      return Number.isNaN(ts) || ts >= cutoff;
    });
    if (withinWindow.length > 0) results = withinWindow;
  }

  results.sort((a, b) => b.scores.overall - a.scores.overall);

  const response: SearchResponse = {
    query: trimmed,
    plan,
    results,
    provider,
    cacheHit: false,
    tookMs: Date.now() - started,
    degraded,
  };

  if (!options.noCache && results.length > 0) {
    await cacheSet(lookup, response, ttlForIntent(plan.intent, freshnessHours));
  }

  return response;
}

export const hasSearchProviderKey = () => configuredKeyedProvider() !== null;
