import { cacheGet, cacheSet, ttlForIntent } from "@/lib/core/cache";
import { offload } from "@/lib/core/offload";
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

/**
 * Latency budget.
 *
 * Nearly all of a search's wall clock is spent waiting on other people's
 * servers, so the only real levers are how many of them we wait for and how
 * long we are willing to wait. Every candidate used to be downloaded before
 * ranking, which meant paying for a dozen page fetches to publish six results.
 * Candidates are now ranked on title and snippet first — signals the providers
 * already gave us, costing nothing — and only the survivors are fetched.
 */
const MAX_ENRICH_CONCURRENCY = 12;

/** Pages fetched beyond the requested count, as insurance against dead links. */
const ENRICH_HEADROOM = 1;

/**
 * Ceiling on how many pages one search downloads. Extraction is the whole cost
 * of a search, and the value of the Nth page falls off fast — the results
 * below this line keep the snippet their source already returned, which is
 * what they would have fallen back to on a timeout anyway.
 */
const MAX_FETCHES = 5;

/**
 * Hosts whose links are wrappers rather than pages. Google News RSS items are
 * base64 redirect stubs: fetching one costs a full round trip and consistently
 * extracts nothing, which is exactly the "içerik-çıkarılamadı" signal those
 * results kept carrying. Their own snippet is the better answer and free.
 */
const UNEXTRACTABLE = [/(^|\.)news\.google\.com$/i];

function isUnextractable(url: string): boolean {
  try {
    return UNEXTRACTABLE.some((p) => p.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/**
 * Wall-clock cut-off for content extraction, measured from the start of the
 * request. Discovery has already spent part of the budget by the time this
 * stage runs, so it is an absolute deadline rather than a per-stage timeout.
 */
const ENRICH_DEADLINE_MS = 1200;

/**
 * Providers are asked for more than the caller wants. Deduplication, the
 * relevance gate and the freshness window all discard candidates, so a thin
 * request would otherwise return fewer results than asked for.
 */
const CANDIDATE_MULTIPLIER = 2;
const MIN_CANDIDATES = 10;

/**
 * Discovery stops early once this many sources have answered with something.
 *
 * The fan-out used to be paid for at the price of its slowest member every
 * time: with six sources answering in 150ms, the request still sat until the
 * deadline for the seventh. A source cut short here is not dropped — it takes
 * the same stale-cache path as a source that missed the deadline, so the
 * saving is in waiting, not in coverage.
 *
 * The floor exists because Marginalia has been measured answering in 202ms;
 * exiting before that would cut the open web off on every fast query.
 */
const EARLY_EXIT_PROVIDERS = 4;
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

/**
 * How long the fan-out is given before the results in hand are used.
 *
 * Split by tier, because the two are not worth the same wait. Dropping a
 * vertical costs one slice of the web; dropping both general indexes costs the
 * web itself — a uniform 1.5s cut Marginalia off and left a technical question
 * answered by Wikipedia and Stack Overflow alone. Verticals are fast APIs, so
 * one that has not answered in 1.5s is in trouble rather than being thorough.
 */
const DISCOVERY_DEADLINE_MS = { web: 700, vertical: 600 } as const;

/**
 * Resolves with the promise's value, or null once `ms` has passed. The loser
 * is left running rather than cancelled — it is still doing useful work for
 * the provider cache — but its timer is cleared so it cannot hold the process.
 */
function raceDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null);

  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });

  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

interface DiscoveryOutcome {
  results: RawResult[];
  provider: string;
  degraded: { provider: string; reason: string }[];
}

/**
 * How long one source's raw answer stays reusable. Short, because this is not
 * the answer cache — it exists so that a source having a bad minute does not
 * remove its whole slice of the web from the results.
 */
const PROVIDER_CACHE_TTL_SECONDS = 900;

function providerLookup(provider: Provider, query: string, locale: string) {
  return { namespace: `provider:${provider.name}`, query, locale };
}

/**
 * Runs one source, remembering what it last said.
 *
 * Marginalia measurably answered a query in 202ms and then failed to answer
 * the same one at all minutes later. Without this, every such minute silently
 * removed the open web from the results and the user saw only verticals. A
 * recent answer from a source that is currently unreachable is far better than
 * no answer from it, so its last reply stands in — and is reported as stale
 * rather than passed off as fresh.
 */
async function runProvider(
  provider: Provider,
  query: string,
  limit: number,
  locale: string,
  freshnessHours: number | null | undefined,
  degraded: { provider: string; reason: string }[]
): Promise<RawResult[]> {
  const lookup = providerLookup(provider, query, locale);

  const fallback = async (reason: string): Promise<RawResult[]> => {
    const cached = await cacheGet<RawResult[]>(lookup);
    if (cached && cached.payload.length > 0) {
      degraded.push({ provider: provider.name, reason: `${reason} (son yanıtı kullanıldı)` });
      return cached.payload.slice(0, limit);
    }
    degraded.push({ provider: provider.name, reason });
    return [];
  };

  try {
    const results = await provider.search(query, limit, locale, freshnessHours);
    if (results.length === 0) return fallback("no_results");

    // Deliberately not awaited: this write only matters to a later request,
    // and the extraction stage that follows gives it ample time to land.
    // Awaiting it would add a database round trip per source to every search.
    void cacheSet(lookup, results, PROVIDER_CACHE_TTL_SECONDS);
    return results;
  } catch (err) {
    return fallback(err instanceof Error ? err.message.slice(0, 100) : "failed");
  }
}

async function discover(
  plan: QueryPlan,
  limit: number,
  locale: string,
  freshnessHours: number | null | undefined,
  onFirstResults?: (results: RawResult[]) => void
): Promise<DiscoveryOutcome> {
  const degraded: { provider: string; reason: string }[] = [];

  // Every source is asked at once and the answers are fused; there is no
  // single "best" index to try first.
  //
  // The fan-out is not waited out in full. One slow source otherwise decides
  // the response time for all of them, and the marginal value of its results
  // is small once five others have answered. A source that misses the deadline
  // is not cancelled: it finishes in the background and writes to the provider
  // cache, so the next request for this query gets it for free.
  const open = openProvidersForIntent(plan.intent);
  const startedAt = Date.now();

  const inFlight = open.map((provider) => ({
    name: provider.name,
    deadline: startedAt + DISCOVERY_DEADLINE_MS[provider.tier],
    lookup: providerLookup(provider, plan.optimized, locale),
    answer: runProvider(provider, plan.optimized, limit, locale, freshnessHours, degraded).then(
      (results) => filterUnsafe(results)
    ),
  }));

  // Watch the answers as they land rather than only at the end, for two
  // reasons: the first ones name pages worth downloading immediately, and once
  // enough sources have spoken there is nothing left to wait for.
  const captured = new Map<string, RawResult[]>();
  let answeredWithResults = 0;
  let announced = false;
  let releaseEarly: () => void = () => {};
  const earlyExit = new Promise<void>((resolve) => {
    releaseEarly = resolve;
  });

  for (const { name, answer } of inFlight) {
    void answer.then((results) => {
      captured.set(name, results);
      if (results.length === 0) return;
      answeredWithResults += 1;

      if (!announced && onFirstResults) {
        announced = true;
        onFirstResults(results);
      }

      if (
        answeredWithResults >= Math.min(EARLY_EXIT_PROVIDERS, open.length) &&
        Date.now() - startedAt >= EARLY_EXIT_FLOOR_MS
      ) {
        releaseEarly();
      }
    });
  }

  // The floor is a wall clock, not a count: without this timer a query where
  // every source answers in 80ms would never reach the check above again.
  const floorTimer = setTimeout(() => {
    if (answeredWithResults >= Math.min(EARLY_EXIT_PROVIDERS, open.length)) releaseEarly();
  }, EARLY_EXIT_FLOOR_MS);

  let settled = await Promise.all(
    inFlight.map(async ({ name, answer, deadline, lookup }) => {
      const inTime = await Promise.race([
        raceDeadline(answer, deadline - Date.now()),
        earlyExit.then(() => null),
      ]);
      if (inTime !== null) return { name, results: inTime };

      // Cut short rather than timed out: the answer may have landed in the
      // same instant the race was decided, and throwing it away would make the
      // early exit cost coverage it does not need to cost.
      const late = captured.get(name);
      if (late && late.length > 0) return { name, results: late };

      // A source that already explained itself — no_results, an error, its own
      // stale cache — must not also be reported as having missed the deadline.
      // It answered; the answer was just empty.
      if (captured.has(name)) return { name, results: [] as RawResult[] };

      // A source that ran out of time still has a recent answer on file, and
      // that beats dropping its whole slice of the web. Without this the
      // deadline could only be bought by losing coverage, which is why it had
      // to be generous; with it the wait can be short.
      const cached = await cacheGet<RawResult[]>(lookup);
      if (cached && cached.payload.length > 0) {
        degraded.push({ provider: name, reason: "deadline (son yanıtı kullanıldı)" });
        return { name, results: cached.payload.slice(0, limit) };
      }

      degraded.push({ provider: name, reason: "deadline" });
      return { name, results: [] as RawResult[] };
    })
  );

  // Cutting the fan-out short is only an optimisation while something did
  // arrive. If every source was slow, an empty answer is not a faster answer —
  // it is a wrong one — so wait for them properly.
  if (settled.every((s) => s.results.length === 0)) {
    settled = await Promise.all(
      inFlight.map(async ({ name, answer }) => ({ name, results: await answer }))
    );
  }
  clearTimeout(floorTimer);

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

/**
 * Fetches page content, bounded so one slow host can't stall the response.
 *
 * `deadline` is a wall-clock cut-off for the whole stage: whatever has not
 * arrived by then falls back to the provider's snippet. A late page is worth
 * less than a prompt answer, and without this the response time is decided by
 * the slowest server in the result set.
 */
type ExtractedPage = Awaited<ReturnType<typeof fetchAndExtract>>;

async function enrich(
  results: RawResult[],
  options: SearchOptions,
  deadline: number,
  inFlightPages: Map<string, Promise<ExtractedPage>>
): Promise<{ raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null }[]> {
  const snippetOnly = (raw: RawResult) => ({
    raw,
    content: raw.snippet,
    updatedAt: null,
    publishedAt: raw.publishedAt ?? null,
  });

  if (options.includeContent === false) {
    return results.map((raw) => ({ ...snippetOnly(raw), content: "" }));
  }

  // Results are already ordered by the cheap pre-score, so the budget goes to
  // the ones most likely to be published.
  // A speculative fetch that the final ranking kept counts against the budget
  // like any other; one it discarded is sunk cost, not a charge against the
  // pages that did make the cut. Subtracting them all up front meant a search
  // whose early candidates lost could fetch only two of its five.
  let budget = MAX_FETCHES;
  const out: { raw: RawResult; content: string; updatedAt: string | null; publishedAt: string | null }[] = [];

  for (let i = 0; i < results.length; i += MAX_ENRICH_CONCURRENCY) {
    const batch = results.slice(i, i + MAX_ENRICH_CONCURRENCY);
    const remaining = deadline - Date.now();

    const pages = await Promise.all(
      batch.map(async (raw) => {
        // A page already being downloaded is taken whatever the deadline says:
        // it was started during discovery and is likely finished. It is keyed
        // canonically because the copy that survives rank fusion can carry a
        // different spelling of the same URL than the one prefetched.
        const speculative = inFlightPages.get(urlKey(raw.url));
        if (speculative) budget -= 1;

        const page = speculative
          ? await speculative
          : remaining <= 0 || budget <= 0 || isUnextractable(raw.url)
            ? null
            : await (() => {
                budget -= 1;
                return fetchAndExtract(raw.url, {
                  policy: options.domainPolicy,
                  timeoutMs: Math.min(1800, remaining),
                });
              })();
        if (!page) return snippetOnly(raw);

        return {
          raw,
          content: page.content || raw.snippet,
          updatedAt: page.updatedAt,
          // A date from the page itself beats the provider's guess.
          publishedAt: page.publishedAt ?? raw.publishedAt ?? null,
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

  // Downloading pages used to begin only after the last source had answered,
  // so two stages that are both pure waiting were run one after the other. The
  // first source's best-looking results are downloaded while the rest of the
  // fan-out is still in flight, which takes that wait off the total instead of
  // adding to it.
  const inFlightPages = new Map<string, Promise<ExtractedPage>>();
  const wantsContent = options.includeContent !== false;

  const startPrefetch = (early: RawResult[]) => {
    if (!wantsContent) return;
    const remaining = started + ENRICH_DEADLINE_MS - Date.now();
    if (remaining <= 200) return;

    const head = [...early]
      .sort((a, b) => preScore(b, plan) - preScore(a, plan))
      .filter((r) => !isUnextractable(r.url))
      .slice(0, PREFETCH_MAX);

    for (const candidate of head) {
      const key = urlKey(candidate.url);
      if (inFlightPages.has(key)) continue;
      inFlightPages.set(
        key,
        fetchAndExtract(candidate.url, {
          policy: options.domainPolicy,
          timeoutMs: Math.min(1800, remaining),
        }).catch(() => null)
      );
    }
  };

  const {
    results: candidates,
    provider,
    degraded,
  } = await discover(plan, candidateCount, locale, freshnessHours, startPrefetch);

  // Rank the whole candidate pool on the free signals, then fetch only the
  // head of it. Cutting the pool before ranking wasted the extra candidates;
  // fetching all of them wasted the caller's time. Ordering first and fetching
  // second keeps the choice and drops the cost.
  const raw = [...candidates]
    .sort((a, b) => preScore(b, plan) - preScore(a, plan))
    .slice(0, maxResults + ENRICH_HEADROOM);

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

  // Whatever has not been fetched by this point is served from its snippet.
  const enriched = await enrich(raw, options, started + ENRICH_DEADLINE_MS, inFlightPages);
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
  if (onTopic.length > 0) results = onTopic;

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

  // Written after the response is sent: the caller has their answer, and the
  // cache write only matters to the next request.
  if (!options.noCache && results.length > 0) {
    offload(() => cacheSet(lookup, response, ttlForIntent(plan.intent, freshnessHours)));
  }

  return response;
}

