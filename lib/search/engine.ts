import { cacheGet, cacheSet, ttlForIntent } from "@/lib/core/cache";
import { CloudaError } from "@/lib/core/errors";
import { filterUnsafe } from "@/lib/search/safety";
import { fetchAndExtract } from "@/lib/search/extract";
import { planQuery } from "@/lib/search/query";
import { scoreResult, MIN_USEFUL_RELEVANCE } from "@/lib/search/scoring";
import { openProvidersForIntent, Provider } from "@/lib/search/providers";
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
 *   discover   ask every source that suits the intent at once and fuse their
 *              rankings; each failure is recorded rather than swallowed
 *   enrich     fetch each candidate and extract readable text plus real dates
 *   score      attach relevance/credibility/freshness/overall, re-rank, and
 *              spread the head across hosts
 *
 * There is no paid provider and no key: discovery runs on open indexes only.
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

/** Canonical form of a URL, so the same page from two indexes counts once. */
function urlKey(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    // Campaign parameters change nothing about the page.
    for (const p of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source$)/i.test(p)) url.searchParams.delete(p);
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}${url.search}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Reciprocal rank fusion.
 *
 * Round-robin interleaving treated every list position as equal, so a source's
 * tenth-best result entered ahead of another source's second-best. RRF scores
 * each document as the sum of 1/(k + rank) over the lists it appears in, which
 * both respects each source's own ordering and rewards agreement between them
 * — a page several indexes surface independently is the strongest signal an
 * aggregator has. k=60 is the constant from the original paper; it damps the
 * gap between the top few positions so one source cannot dictate the head.
 */
const RRF_K = 60;

function fuseByRank(lists: { name: string; results: RawResult[] }[], limit: number): RawResult[] {
  const scores = new Map<string, { score: number; item: RawResult; sources: Set<string> }>();

  for (const list of lists) {
    list.results.forEach((item, rank) => {
      const key = urlKey(item.url);
      const entry = scores.get(key);
      const contribution = 1 / (RRF_K + rank + 1);

      if (entry) {
        entry.score += contribution;
        entry.sources.add(list.name);
        // Keep whichever copy carries the richer snippet.
        if ((item.snippet?.length ?? 0) > (entry.item.snippet?.length ?? 0)) {
          entry.item = { ...entry.item, snippet: item.snippet };
        }
        if (!entry.item.publishedAt && item.publishedAt) {
          entry.item = { ...entry.item, publishedAt: item.publishedAt };
        }
      } else {
        scores.set(key, { score: contribution, item, sources: new Set([list.name]) });
      }
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || b.sources.size - a.sources.size)
    .slice(0, limit)
    .map((e) => e.item);
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

  // Every source is asked at once and the answers are fused; there is no
  // single "best" index to try first.
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
    results: fuseByRank(chosen, limit),
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

/**
 * Takes the top `limit` results while holding any single host to two entries,
 * so a site that happens to rank well does not fill the whole page. Anything
 * held back is appended if the quota is not otherwise filled — fewer results
 * would be a worse answer than a slightly repetitive one.
 */
const MAX_PER_HOST = 2;

function diversifyByHost(results: SearchResult[], limit: number): SearchResult[] {
  const perHost = new Map<string, number>();
  const kept: SearchResult[] = [];
  const held: SearchResult[] = [];

  for (const result of results) {
    let host = "";
    try {
      host = new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      /* keep an unparseable URL in the main flow */
    }

    const seen = perHost.get(host) ?? 0;
    if (host && seen >= MAX_PER_HOST) {
      held.push(result);
      continue;
    }
    perHost.set(host, seen + 1);
    kept.push(result);
    if (kept.length >= limit) break;
  }

  return kept.length >= limit ? kept : [...kept, ...held].slice(0, limit);
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

  // Score the whole candidate pool, not the first maxResults of it. Cutting
  // here was self-defeating: the extra candidates were fetched precisely so
  // that ranking could choose among them, and truncating first meant a better
  // result sitting at position 11 could never displace a worse one at 3.
  const raw = candidates;

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

  // Drop the plainly off-topic, but never to the point of returning nothing:
  // a weak answer beats an empty one when no source covered the question.
  const onTopic = results.filter((r) => r.scores.relevance >= MIN_USEFUL_RELEVANCE);
  if (onTopic.length >= Math.min(3, results.length)) results = onTopic;

  results.sort((a, b) => b.scores.overall - a.scores.overall);
  results = diversifyByHost(results, maxResults);

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

