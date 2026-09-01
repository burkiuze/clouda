import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseInt_ } from "@/lib/api/shapes";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { fetchAndExtract } from "@/lib/search/extract";
import { FEEDS, matchNews, newsCorpus, NewsItem } from "@/lib/search/newsroom";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface NewsBody {
  query?: string;
  lang?: string;
  topics?: string[];
  sources?: string[];
  freshness?: string | number;
  max_results?: number;
  include_content?: boolean;
}

const TOPICS = ["general", "business", "tech", "science", "world"] as const;
type Topic = (typeof TOPICS)[number];

/** Pages fetched for a news request that asked for full article text. */
const MAX_ARTICLE_FETCHES = 5;
const ARTICLE_TIMEOUT_MS = 2500;

function parseList(value: unknown, allowed: readonly string[], field: string): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new CloudaError("invalid_request", `'${field}' bir metin dizisi olmalı.`);
  }
  const bad = value.find((v) => !allowed.includes(v));
  if (bad) {
    throw new CloudaError(
      "invalid_request",
      `Geçersiz ${field}: ${bad}. Desteklenenler: ${allowed.join(", ")}`
    );
  }
  return value;
}

/**
 * POST /api/v1/news — headlines, not web pages.
 *
 * Search answers a question; this answers "what is happening". A query is
 * optional here precisely because the most common news request has no query
 * at all — an agent asking what the last hour looked like has nothing to
 * search for. Both shapes read the same background-refreshed corpus, so a
 * request costs a match over memory rather than a fan-out.
 *
 * Always available on every key, like search: it is the same capability
 * looking at a different corpus.
 */
export const POST = withApi(
  { operation: "search", estimateCredits: CREDITS.search },
  async (req: NextRequest, ctx) => {
    const body = await readJson<NewsBody>(req);

    const query = body.query?.trim() ?? "";
    if (query.length > 400) {
      throw new CloudaError("query_too_long", "Sorgu 400 karakteri aşamaz.");
    }

    const lang = body.lang == null ? null : String(body.lang).toLowerCase().slice(0, 2);
    if (lang && lang !== "tr" && lang !== "en") {
      throw new CloudaError("invalid_request", "'lang' yalnızca 'tr' ya da 'en' olabilir.");
    }

    const topics = parseList(body.topics, TOPICS, "topics") as Topic[] | null;
    const sources = parseList(
      body.sources,
      FEEDS.map((f) => f.name),
      "sources"
    );

    const limit = parseInt_(body.max_results, 1, 50, 10);
    const freshnessHours = parseFreshness(body.freshness) ?? null;
    const wantsContent = body.include_content === true;

    const corpus = await newsCorpus({ blocking: true });
    if (corpus.length === 0) {
      throw new CloudaError("provider_failed", "Haber kaynakları şu anda yanıt vermiyor.");
    }

    // Filters run before matching so a narrow request still gets a full page
    // of results out of the slice it asked for.
    const byName = new Map(FEEDS.map((f) => [f.name, f]));
    let pool = corpus;
    if (lang) pool = pool.filter((item) => item.lang === lang);
    if (sources) pool = pool.filter((item) => sources.includes(item.source));
    if (topics) {
      pool = pool.filter((item) => {
        const feed = byName.get(item.source);
        return feed ? feed.topics.some((t) => topics.includes(t as Topic)) : false;
      });
    }

    let items: NewsItem[];
    if (query) {
      items = matchNews(pool, query, limit, freshnessHours);
    } else {
      // No query: the corpus is already ordered newest-first, so the headline
      // request is a window over it rather than a search.
      const cutoff = freshnessHours != null ? Date.now() - freshnessHours * 3_600_000 : null;
      items = pool
        .filter((item) => {
          if (cutoff == null || !item.publishedAt) return true;
          const ts = Date.parse(item.publishedAt);
          return Number.isNaN(ts) || ts >= cutoff;
        })
        .slice(0, limit);
    }

    const contents = new Map<string, string>();
    if (wantsContent && items.length > 0) {
      const head = items.slice(0, MAX_ARTICLE_FETCHES);
      const pages = await Promise.all(
        head.map((item) =>
          fetchAndExtract(item.url, { policy: ctx.policy, timeoutMs: ARTICLE_TIMEOUT_MS }).catch(
            () => null
          )
        )
      );
      head.forEach((item, i) => {
        const page = pages[i];
        if (page?.content) contents.set(item.url, page.content);
      });
    }

    return {
      body: {
        query: query || null,
        filters: {
          lang: lang ?? "all",
          topics: topics ?? "all",
          sources: sources ?? "all",
          freshness_hours: freshnessHours,
        },
        corpus_size: corpus.length,
        articles: items.map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          published_at: item.publishedAt,
          publisher: item.source,
          lang: item.lang,
          ...(wantsContent ? { content: contents.get(item.url) ?? item.snippet } : {}),
        })),
      },
      // A request that read article pages did the work of a search; one that
      // only read the corpus did not.
      creditsUsed: wantsContent ? CREDITS.search : CREDITS.searchNoContent,
      resultCount: items.length,
      provider: "newsroom",
      cacheHit: !wantsContent,
      label: query || "top-headlines",
    };
  }
);
