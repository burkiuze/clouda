import { cacheGet, cacheSet, cacheKey, ttlForIntent } from "@/lib/core/cache";
import { offload } from "@/lib/core/offload";
import { circuitOpen, recordFailure, recordSuccess } from "@/lib/core/breaker";
import { CloudaError } from "@/lib/core/errors";
import { filterUnsafe } from "@/lib/search/safety";
import { hostMatches, isUrlAllowed } from "@/lib/core/security";
import { fetchAndExtract } from "@/lib/search/extract";
import { planQuery } from "@/lib/search/query";
import { scoreResult, MIN_USEFUL_RELEVANCE } from "@/lib/search/scoring";
import { openProvidersForIntent, searchProvider, Provider } from "@/lib/search/providers";
import type {
  QueryPlan,
  RawResult,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";

import { within, SingleFlight } from "@/lib/core/async";
import { withFetchSignal } from "@/lib/core/http";
import { SEARCH_PROFILES } from "@/lib/search/profiles";

export const DEFAULT_LOCALE = "tr-TR";

/**
 * The search pipeline, in four stages:
 *
 *   plan       classify intent, clean the query, decide on freshness
 *   discover   ask suitable sources in bounded waves and fuse their rankings;
 *              each failure is recorded rather than swallowed
 *   enrich     fetch each candidate and extract readable text plus real dates
 *   score      attach relevance/credibility/freshness/overall, re-rank, and
 *              spread the head across hosts
 *
 * Discovery uses open indexes and an optional operator-configured backend.
 *
 * Results are cached by normalised query, with the freshness window part of
 * the cache contract so a "last hour" request never gets a day-old row.
 */

/** Fetch only the best candidates, within the selected profile budget. */
const ENRICH_HEADROOM = 1;

/** These hosts generally supply snippets rather than extractable pages. */
const UNEXTRACTABLE = [
  /(^|\.)news\.google\.com$/i,
  /(^|\.)stackoverflow\.com$/i,
  /(^|\.)serverfault\.com$/i,
  /(^|\.)superuser\.com$/i,
  /(^|\.)askubuntu\.com$/i,
  /(^|\.)stackexchange\.com$/i,
];

function isUnextractable(url: string): boolean {
  try {
    return UNEXTRACTABLE.some((p) => p.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/** One page cannot spend the entire search budget. */
const PAGE_TIMEOUT_MS = 1000;

/**
 * Providers are asked for more than the caller wants. Deduplication, the
 * relevance gate and the freshness window all discard candidates, so a thin
 * request would otherwise return fewer results than asked for.
 */
const CANDIDATE_MULTIPLIER = 2;
const MIN_CANDIDATES = 10;

/** Give active sources a short window before ending their foreground wait. */
const EARLY_EXIT_FLOOR_MS = 220;

/**
 * Pages fetched speculatively while the remaining sources are still answering.
 *
 * Discovery and extraction are both pure waiting, and they were serialised:
 * nothing was downloaded until the last source had spoken. The first source to
 * answer already names pages the final ranking will almost certainly keep, so
 * their download starts immediately and overlaps the rest of the fan-out. The
 * cap is low because a speculative fetch that misses the final cut is wasted
 * bandwidth — it is never wasted time.
 */
const PREFETCH_MAX = 3;

/**
 * Cheap pre-ranking over what a provider already told us. Deliberately crude:
 * its only job is to decide which candidates are worth a network round trip,
 * after which the real scorer runs on the full page text.
 */
function preScore(result: RawResult, plan: QueryPlan): number {
  const terms = plan.optimized
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return 0.5;

  const title = result.title.toLowerCase();
  const snippet = (result.snippet ?? "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 0.6 / terms.length;
    else if (snippet.includes(term)) score += 0.4 / terms.length;
  }

  // An exact phrase in the title is the strongest cheap signal available.
  if (title.includes(plan.optimized.toLowerCase())) score += 0.3;
  return score;
}

/**
 * Applies the caller's per-request domain filter to the candidate pool.
 *
 * Runs before enrichment on purpose: filtering after the fetches would pay for
 * pages it then discards, so a narrowed search is a cheaper search as well as
 * a more precise one.
 */
function applyDomainFilter(
  results: RawResult[],
  filter: { include?: string[]; exclude?: string[] } | undefined
): RawResult[] {
  if (!filter || (!filter.include?.length && !filter.exclude?.length)) return results;

  return results.filter((result) => {
    let host: string;
    try {
      host = new URL(result.url).hostname;
    } catch {
      return false;
    }
    if (filter.exclude?.some((d) => hostMatches(host, d))) return false;
    if (filter.include?.length) return filter.include.some((d) => hostMatches(host, d));
    return true;
  });
}

/**
 * Normalises a publication date to ISO 8601.
 *
 * Sources disagree about format — an RSS-backed one hands back RFC-822
 * ("Mon, 31 Aug 2026 20:07:31 GMT") while an API-backed one hands back ISO —
 * and that disagreement was reaching callers in the same `published_at` field,
 * leaving every consumer to guess. Anything unparseable is dropped rather than
 * passed through: a date a caller cannot parse is worse than no date.
 */
function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/** Canonical form of a URL, so the same page from two indexes counts once. */
function urlKey(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    // Campaign parameters change nothing about the page.
    for (const p of [...url.searchParams.keys()]) {
      if (/^(utm_.*|fbclid|gclid)$/i.test(p)) url.searchParams.delete(p);
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.replace(/^www\./, "")}${path}${url.search}`;
  } catch {
    return raw.replace(/\/+$/, "");
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
    const seen = new Set<string>();
    list.results.forEach((item, rank) => {
      const key = urlKey(item.url);
      if (seen.has(key)) return;
      seen.add(key);
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

/** A slow source may warm its cache, but cannot run forever. */
const PROVIDER_WORK_TIMEOUT_MS = 2500;
const PROVIDER_CACHE_TTL_SECONDS = 900;

interface ProviderOutcome { results: RawResult[]; reason?: string; skipped?: boolean }
interface DiscoveryOutcome {
  results: RawResult[];
  provider: string;
  providersQueried: number;
  providersWithResults: number;
  degraded: { provider: string; reason: string }[];
}
const providerFlights = new SingleFlight<ProviderOutcome>();

function providerLookup(provider: Provider, query: string, locale: string, limit: number, freshnessHours?: number | null) {
  return { namespace: "provider:" + provider.name, query, locale, maxResults: limit, freshnessHours };
}

/** Only accepted candidates count towards early exit or speculative downloads. */
function accepted(results: RawResult[], options: SearchOptions, freshnessHours?: number | null): RawResult[] {
  const cutoff = freshnessHours == null ? null : Date.now() - freshnessHours * 3_600_000;
  return applyDomainFilter(filterUnsafe(results), options.domainFilter).filter((r) => {
    if (!isUrlAllowed(r.url, options.domainPolicy)) return false;
    const date = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
    return cutoff === null || !Number.isFinite(date) || date >= cutoff;
  });
}

function runProvider(
  provider: Provider, query: string, limit: number, locale: string,
  freshnessHours: number | null | undefined, noCache: boolean
): Promise<ProviderOutcome> {
  const lookup = providerLookup(provider, query, locale, limit, freshnessHours);
  return providerFlights.run(cacheKey(lookup) + (noCache ? ":uncached" : ""), async () => {
    const circuit = circuitOpen(provider.name);
    if (circuit.open) return { results: [], reason: circuit.reason ?? "circuit_open" };
    const started = Date.now();
    const controller = new AbortController();
    try {
      const result = await within(
        withFetchSignal(controller.signal, () => searchProvider(provider, query, limit, locale, freshnessHours)),
        PROVIDER_WORK_TIMEOUT_MS
      );
      if (result === null) throw new CloudaError("fetch_timeout", "provider_timeout");
      const results = result.filter((r) => r && typeof r.url === "string" &&
        typeof r.title === "string" && typeof r.snippet === "string");
      recordSuccess(provider.name, Date.now() - started);
      if (results.length === 0) return { results, reason: "no_results" };
      if (!noCache) {
        void cacheSet(lookup, results, PROVIDER_CACHE_TTL_SECONDS, { background: true });
      }
      return { results };
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 100) : "failed";
      recordFailure(provider.name, reason);
      return { results: [], reason };
    } finally {
      controller.abort();
    }
  });
}

async function discover(
  plan: QueryPlan, limit: number, locale: string, freshnessHours: number | null | undefined,
  options: SearchOptions, onResults?: (results: RawResult[]) => void
): Promise<DiscoveryOutcome> {
  const open = openProvidersForIntent(plan.intent).filter((p) => p.available());
  if (open.length === 0) return { results: [], provider: "none", degraded: [], providersQueried: 0, providersWithResults: 0 };
  const profile = SEARCH_PROFILES[options.depth ?? "balanced"];
  const deep = options.depth === "deep";
  const started = Date.now();
  const early = new AbortController();
  const reserves = new AbortController();
  const captured = new Map<string, ProviderOutcome>();
  const useful = new Map<string, RawResult[]>();
  let providersQueried = 0;
  let closed = false;
  const enough = () => {
    const count = new Set([...useful.values()].flat().map((r) => urlKey(r.url))).size;
    return !deep && useful.size >= Math.min(profile.primarySources, open.length) &&
      count >= Math.ceil(limit / CANDIDATE_MULTIPLIER);
  };
  const floorTimer = setTimeout(() => { if (enough()) early.abort(); }, EARLY_EXIT_FLOOR_MS);

  // Start stale-cache reads alongside live discovery, never AFTER a deadline.
  const inFlight = open.map((provider, index) => {
    let cached: ReturnType<typeof cacheGet<RawResult[]>> = Promise.resolve(null);
    const live = (async (): Promise<ProviderOutcome> => {
      if (index >= profile.primarySources) {
        await within(new Promise<never>(() => {}), profile.fallbackDelayMs, reserves.signal);
        if (closed || enough()) return { results: [], skipped: true };
      }
      providersQueried++;
      cached = options.noCache ? Promise.resolve(null) :
        cacheGet<RawResult[]>(providerLookup(provider, plan.optimized, locale, limit, freshnessHours));
      const outcome = await runProvider(provider, plan.optimized, limit, locale, freshnessHours, options.noCache === true);
      const results = accepted(outcome.results, options, freshnessHours);
      const answer = { ...outcome, results };
      captured.set(provider.name, answer);
      if (!closed && results.length) {
        const relevant = relevanceGate(results, plan);
        if (relevant.length) useful.set(provider.name, relevant);
        onResults?.(relevant);
        if (enough()) reserves.abort();
        if (enough() && Date.now() - started >= EARLY_EXIT_FLOOR_MS) early.abort();
      }
      return answer;
    })();
    return { provider, cached: () => cached, live };
  });

  // Register running work with the request lifecycle so serverless runtimes
  // can finish bounded cache warming after sending the response.
  offload(() => Promise.all(inFlight.map((entry) => entry.live)));

  const resolveEntry = async (entry: typeof inFlight[number], outcome: ProviderOutcome | null) => {
    if (outcome?.skipped) return { name: entry.provider.name, results: [], skipped: true };
    if (outcome?.results.length) return { name: entry.provider.name, ...outcome };
    const hit = await entry.cached();
    const stale = hit ? accepted(hit.payload, options, freshnessHours).slice(0, limit) : [];
    const reason = outcome?.reason ?? (outcome ? "no_results" : "deadline");
    return { name: entry.provider.name, results: stale,
      reason: stale.length ? reason + " (son yanıtı kullanıldı)" : reason };
  };

  try {
    let settled = await Promise.all(inFlight.map(async (entry) => {
      const outcome = await within(entry.live,
        started + (entry.provider.tier === "web" ? profile.webMs : profile.verticalMs) - Date.now(), early.signal);
      return resolveEntry(entry, outcome ?? captured.get(entry.provider.name) ?? null);
    }));

    // A bounded recovery window preserves late results without waiting for the
    // slowest source indefinitely. On expiry, partial/empty results are honest.
    if (settled.every((s) => s.results.length === 0) || deep) {
      await within(Promise.all(inFlight.map((entry) => entry.live)),
        started + profile.recoveryMs - Date.now());
      settled = await Promise.all(inFlight.map((entry) =>
        resolveEntry(entry, captured.get(entry.provider.name) ?? null)));
    }

    const answered = settled.filter((s) => s.results.length > 0);
    const gated = answered.map((s) => ({ ...s, results: relevanceGate(s.results, plan) }))
      .filter((s) => s.results.length > 0);
    const chosen = gated.length ? gated : answered;
    return {
      results: fuseByRank(chosen, limit),
      provider: chosen.map((s) => s.name).join("+") || "none",
      providersQueried,
      providersWithResults: chosen.length,
      degraded: settled.filter((s) => s.reason).map((s) => ({ provider: s.name, reason: s.reason! })),
    };
  } finally {
    closed = true;
    clearTimeout(floorTimer);
    early.abort();
    reserves.abort();
  }
}

/**
 * Fetches page content, bounded so one slow host can't stall the response.
 *
 * `deadline` is a wall-clock cut-off for the whole stage: whatever has not
 * arrived by then falls back to the provider's snippet. A late page is worth
 * less than a prompt answer, and without this the response time is decided by
 * the slowest server in the result set.
 */
type ExtractedPage = Awaited<ReturnType<typeof fetchAndExtract>>;
interface PageWork { promise: Promise<ExtractedPage>; controller: AbortController }

function extractionPolicy(options: SearchOptions) {
  const policy = options.domainPolicy ?? {};
  const include = options.domainFilter?.include ?? [];
  const allowed = policy.allowedDomains ?? [];
  const intersection = allowed.length && include.length ? allowed.flatMap((a) =>
    include.flatMap((b) => hostMatches(a, b) ? [a] : hostMatches(b, a) ? [b] : [])) : allowed.length ? allowed : include;
  return {
    allowedDomains: allowed.length && include.length && !intersection.length ? ["invalid"] : intersection,
    blockedDomains: [...(policy.blockedDomains ?? []), ...(options.domainFilter?.exclude ?? [])],
  };
}

function startPage(url: string, options: SearchOptions, remaining: number): PageWork {
  const controller = new AbortController();
  const promise = fetchAndExtract(url, {
    policy: extractionPolicy(options), signal: controller.signal,
    timeoutMs: Math.min(PAGE_TIMEOUT_MS, remaining),
  }).catch(() => null);
  return { promise, controller };
}

type EnrichedPage = { raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null };

/**
 * Fetches the addresses the caller put in the query.
 *
 * These are not candidates competing for a place in the results — the caller
 * named them, so they lead the list whatever the ranking would have said. A
 * page that cannot be read still appears, carrying the reason: silently
 * dropping a link someone pasted looks like the tool ignored them.
 */
async function fetchRequested(
  urls: string[],
  options: SearchOptions,
  started: number,
  profile: { enrichMs: number }
): Promise<EnrichedPage[]> {
  const remaining = Math.max(1000, started + profile.enrichMs - Date.now());

  const pages = await Promise.all(
    urls.map(async (url) => {
      // The same SSRF checks as everywhere else: this is caller-supplied input
      // pointed straight at our own fetcher.
      if (!isUrlAllowed(url, extractionPolicy(options))) return null;

      const page = await fetchAndExtract(url, {
        policy: extractionPolicy(options),
        timeoutMs: Math.min(PAGE_TIMEOUT_MS * 2, remaining),
      }).catch(() => null);

      const host = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return url;
        }
      })();

      const raw: RawResult = {
        title: page?.title || host,
        url,
        snippet: page?.content?.slice(0, 300) ?? "Bu adres okunamadı.",
        publishedAt: page?.publishedAt ?? undefined,
      };

      return {
        raw,
        content: options.includeContent === false ? "" : (page?.content ?? ""),
        updatedAt: page?.updatedAt ?? null,
        publishedAt: page?.publishedAt ?? null,
      };
    })
  );

  return pages.filter((page): page is EnrichedPage => page !== null);
}

async function enrich(
  results: RawResult[], options: SearchOptions, deadline: number, inFlightPages: Map<string, PageWork>
): Promise<{ raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null }[]> {
  const snippetOnly = (raw: RawResult) => ({
    raw, content: options.includeContent === false ? "" : raw.snippet,
    updatedAt: null, publishedAt: raw.publishedAt ?? null,
  });
  if (options.includeContent === false) return results.map(snippetOnly);

  return Promise.all(results.map(async (raw) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return snippetOnly(raw);
    const key = urlKey(raw.url);
    let work = inFlightPages.get(key);
    if (!work && inFlightPages.size < SEARCH_PROFILES[options.depth ?? "balanced"].maxFetches && !isUnextractable(raw.url)) {
      work = startPage(raw.url, options, remaining);
      inFlightPages.set(key, work);
    }
    if (!work) return snippetOnly(raw);
    const page = await within(work.promise, remaining);
    if (!page) { work.controller.abort(); return snippetOnly(raw); }
    return { raw, content: page.content || raw.snippet, updatedAt: page.updatedAt,
      publishedAt: page.publishedAt ?? raw.publishedAt ?? null };
  }));
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

async function executeSearch(
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
  const depth = options.depth ?? "balanced";
  const profile = SEARCH_PROFILES[depth];

  const lookup = searchLookup(plan, options, locale, maxResults, freshnessHours);

  if (!options.noCache) {
    const hit = await cacheGet<SearchResponse>(lookup);
    if (hit) {
      const results = accepted(hit.payload.results, options, freshnessHours) as SearchResult[];
      return { ...hit.payload, results,
        diagnostics: { depth, providersQueried: 0, providersWithResults: 0, candidates: 0, pageFetches: 0,
          resultHosts: new Set(results.map((r) => new URL(r.url).hostname)).size },
        cacheHit: true, tookMs: Date.now() - started };
    }
  }

  const candidateCount = Math.max(MIN_CANDIDATES, maxResults * CANDIDATE_MULTIPLIER);

  // Downloading pages used to begin only after the last source had answered,
  // so two stages that are both pure waiting were run one after the other. The
  // first source's best-looking results are downloaded while the rest of the
  // fan-out is still in flight, which takes that wait off the total instead of
  // adding to it.
  const inFlightPages = new Map<string, PageWork>();
  const wantsContent = options.includeContent !== false;

  const startPrefetch = (early: RawResult[]) => {
    if (!wantsContent) return;
    const remaining = started + profile.enrichMs - Date.now();
    if (remaining <= 200) return;

    const head = accepted(early, options, freshnessHours)
      .sort((a, b) => preScore(b, plan) - preScore(a, plan))
      .filter((r) => !isUnextractable(r.url))
      .slice(0, Math.max(0, PREFETCH_MAX - inFlightPages.size));

    for (const candidate of head) {
      const key = urlKey(candidate.url);
      if (inFlightPages.has(key)) continue;
      inFlightPages.set(key, startPage(candidate.url, options, remaining));
    }
  };

  // A link in the query is fetched directly, in parallel with the fan-out.
  //
  // Searching for a URL the caller already has is answering a question they
  // did not ask: the page is right there. When the query was nothing but
  // links, discovery is skipped entirely — there is nothing left to search
  // for, and asking nine sources about a bare URL returns noise.
  const requested = plan.urls.length > 0 ? fetchRequested(plan.urls, options, started, profile) : null;

  const discovered = plan.urlsOnly
    ? { results: [], provider: "url", degraded: [], providersQueried: 0, providersWithResults: 0 }
    : await discover(plan, candidateCount, locale, freshnessHours, options, startPrefetch);

  const {
    results: candidates,
    provider,
    degraded,
    providersQueried,
    providersWithResults,
  } = discovered;

  const diagnostics = (results: RawResult[]) => ({ depth, providersQueried, providersWithResults,
    candidates: candidates.length, pageFetches: inFlightPages.size,
    resultHosts: new Set(results.map((r) => new URL(r.url).hostname)).size });

  // Rank the whole candidate pool on the free signals, then fetch only the
  // head of it. Cutting the pool before ranking wasted the extra candidates;
  // fetching all of them wasted the caller's time. Ordering first and fetching
  // second keeps the choice and drops the cost.
  const requestedPages = requested ? await requested : [];
  const requestedKeys = new Set(requestedPages.map((page) => urlKey(page.raw.url)));

  const raw = accepted(candidates, options, freshnessHours)
    .filter((candidate) => !requestedKeys.has(urlKey(candidate.url)))
    .sort((a, b) => preScore(b, plan) - preScore(a, plan))
    .slice(0, Math.max(0, maxResults + ENRICH_HEADROOM - requestedPages.length));

  // Only give up when there is genuinely nothing — a query that was just a
  // link produces no candidates by design, and returning empty there would
  // drop the one page the caller actually asked for.
  if (raw.length === 0 && requestedPages.length === 0) {
    for (const work of inFlightPages.values()) work.controller.abort();
    return {
      query: trimmed,
      plan,
      results: [],
      diagnostics: diagnostics([]),
      provider,
      cacheHit: false,
      tookMs: Date.now() - started,
      degraded,
    };
  }

  // Whatever has not been fetched by this point is served from its snippet.
  let enriched: Awaited<ReturnType<typeof enrich>>;
  try {
    enriched = await enrich(raw, options, started + profile.enrichMs, inFlightPages);
  } finally {
    for (const work of inFlightPages.values()) work.controller.abort();
  }

  // The caller's own links first, then what discovery found.
  enriched = [...requestedPages, ...enriched];
  const hostCounts = corroborationByHost([...requestedPages.map((p) => p.raw), ...raw]);

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
      publishedAt: isoDate(item.publishedAt),
      updatedAt: isoDate(item.updatedAt),
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
    results = withinWindow;
  }

  // Drop the plainly off-topic, but never to the point of returning nothing:
  // a weak answer beats an empty one when no source covered the question.
  const onTopic = results.filter((r) => r.scores.relevance >= MIN_USEFUL_RELEVANCE);
  if (onTopic.length > 0) results = onTopic;

  results.sort((a, b) => b.scores.overall - a.scores.overall);
  results = diversifyByHost(results, maxResults);

  const response: SearchResponse = {
    query: trimmed,
    plan,
    results,
    diagnostics: diagnostics(results),
    provider,
    cacheHit: false,
    tookMs: Date.now() - started,
    degraded,
  };

  // Written after the response is sent: the caller has their answer, and the
  // cache write only matters to the next request.
  if (!options.noCache && results.length > 0) {
    void cacheSet(lookup, response, ttlForIntent(plan.intent, freshnessHours), { background: true });
  }

  return response;
}


function searchLookup(
  plan: QueryPlan, options: SearchOptions, locale: string, maxResults: number, freshnessHours?: number | null
) {
  const domains = (items?: string[]) => [...new Set((items ?? []).map((d) =>
    d.trim().toLowerCase().replace(/^\*\./, "").replace(/^\./, "").replace(/\.$/, "")))].sort();
  return {
    // The requested links are part of the identity of the answer: "example.com
    // bu ne" and "bu ne" optimize to the same search terms but are not the
    // same question, and without this they would share a cache entry.
    namespace: JSON.stringify(["search", plan.intent, options.includeContent !== false, options.depth ?? "balanced",
      plan.urls,
      domains(options.domainPolicy?.allowedDomains), domains(options.domainPolicy?.blockedDomains),
      domains(options.domainFilter?.include), domains(options.domainFilter?.exclude)]),
    query: plan.optimized, locale, maxResults, freshnessHours,
  };
}

const searchFlights = new SingleFlight<SearchResponse>();

/** Equivalent requests share work, but each caller keeps its own query/timing.
 * Coalescing is per instance and does not change cache-hit billing semantics.
 */
export async function searchWeb(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const started = Date.now();
  if (typeof query !== "string" || !query.trim()) {
    throw new CloudaError("invalid_request", "Sorgu boş olmayan bir metin olmalı.");
  }
  const trimmed = query.trim();
  if (options.depth != null && !["fast", "balanced", "deep"].includes(options.depth)) {
    throw new CloudaError("invalid_request", "Geçersiz arama derinliği.");
  }
  if (trimmed.length > 400) throw new CloudaError("query_too_long", "Sorgu 400 karakteri aşamaz.");
  if (options.maxResults != null && !Number.isFinite(options.maxResults) ||
      options.freshnessHours != null && (!Number.isFinite(options.freshnessHours) || options.freshnessHours <= 0)) {
    throw new CloudaError("invalid_request", "Geçersiz sonuç sayısı veya güncellik aralığı.");
  }
  const maxResults = Math.min(Math.max(Math.round(options.maxResults ?? 10), 1), 30);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const plan = planQuery(trimmed, { freshnessHours: options.freshnessHours });
  const freshnessHours = options.freshnessHours ?? plan.suggestedFreshnessHours;
  const lookup = searchLookup(plan, options, locale, maxResults, freshnessHours);
  const response = await searchFlights.run(cacheKey(lookup) + (options.noCache ? ":uncached" : ""),
    () => executeSearch(trimmed, { ...options, maxResults }));
  return { ...structuredClone(response), query: trimmed, plan, tookMs: Date.now() - started };
}
