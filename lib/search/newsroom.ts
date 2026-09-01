import { cacheGet, cacheSet } from "@/lib/core/cache";
import { offload } from "@/lib/core/offload";
import { safeFetch } from "@/lib/core/http";
import type { RawResult } from "@/lib/search/types";

/**
 * The newsroom: a live corpus of published articles, kept warm out of band.
 *
 * News was the weakest thing this engine did. Google News is the only
 * query-driven news source that answers from a datacenter, and its links are
 * base64 redirect stubs — they can be listed but never read, so a news result
 * arrived without content and without a real URL to give the caller.
 *
 * Publishers' own feeds have neither problem: they carry real article URLs,
 * real publication timestamps, and they are fast. What they do not have is a
 * query interface, so the corpus is pulled in the background and matched here.
 * That inverts the cost of a news search: instead of asking a remote index at
 * request time, the request reads a corpus that is already in memory.
 *
 * Every feed below was measured from this deployment's egress before being
 * listed. Two candidates were dropped for returning nothing (Reuters' feed
 * host no longer resolves, Sözcü's feed parses empty), and GDELT — the obvious
 * keyless global news index — is absent because it timed out at ten seconds on
 * every attempt.
 */

export interface Feed {
  name: string;
  url: string;
  lang: "tr" | "en";
  /** Which intents this feed is worth reading for. */
  topics: ("general" | "business" | "tech" | "science" | "world")[];
}

export const FEEDS: Feed[] = [
  // Turkish
  { name: "aa", url: "https://www.aa.com.tr/tr/rss/default?cat=guncel", lang: "tr", topics: ["general", "world"] },
  { name: "aa-ekonomi", url: "https://www.aa.com.tr/tr/rss/default?cat=ekonomi", lang: "tr", topics: ["business"] },
  { name: "bbc-turkce", url: "https://feeds.bbci.co.uk/turkce/rss.xml", lang: "tr", topics: ["general", "world"] },
  { name: "trt-haber", url: "https://www.trthaber.com/sondakika.rss", lang: "tr", topics: ["general", "world"] },
  { name: "ntv", url: "https://www.ntv.com.tr/gundem.rss", lang: "tr", topics: ["general"] },
  { name: "ntv-ekonomi", url: "https://www.ntv.com.tr/ekonomi.rss", lang: "tr", topics: ["business"] },
  { name: "hurriyet", url: "https://www.hurriyet.com.tr/rss/gundem", lang: "tr", topics: ["general"] },
  { name: "dw-turkce", url: "https://rss.dw.com/rdf/rss-tur-all", lang: "tr", topics: ["general", "world"] },
  // English
  { name: "bbc-world", url: "https://feeds.bbci.co.uk/news/world/rss.xml", lang: "en", topics: ["general", "world"] },
  { name: "bbc-business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", lang: "en", topics: ["business"] },
  { name: "bbc-tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", lang: "en", topics: ["tech"] },
  { name: "guardian", url: "https://www.theguardian.com/world/rss", lang: "en", topics: ["general", "world"] },
  { name: "npr", url: "https://feeds.npr.org/1001/rss.xml", lang: "en", topics: ["general"] },
  { name: "aljazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", lang: "en", topics: ["general", "world"] },
  { name: "nyt-world", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", lang: "en", topics: ["general", "world"] },
  {
    name: "cnbc",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    lang: "en",
    topics: ["business"],
  },
  { name: "yahoo-finance", url: "https://finance.yahoo.com/news/rssindex", lang: "en", topics: ["business"] },
  { name: "ap", url: "https://feedx.net/rss/ap.xml", lang: "en", topics: ["general", "world"] },
  { name: "ars-technica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en", topics: ["tech", "science"] },
  { name: "the-verge", url: "https://www.theverge.com/rss/index.xml", lang: "en", topics: ["tech"] },
  { name: "techcrunch", url: "https://techcrunch.com/feed/", lang: "en", topics: ["tech", "business"] },
  { name: "science-daily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en", topics: ["science"] },
];

export const NEWS_SOURCE_COUNT = FEEDS.length;

export interface NewsItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  source: string;
  lang: "tr" | "en";
}

/**
 * How long a pulled corpus is served for, and when a refresh is triggered.
 *
 * These are deliberately far apart. The refresh threshold is what keeps the
 * corpus current: any request past it triggers a background pull, so under
 * traffic the headlines are never more than a couple of minutes old. The
 * expiry is only a floor on how stale it may get during a quiet spell — and it
 * is long because the alternative is worse. Measured: with a ten-minute
 * expiry, a news search four minutes after the corpus lapsed got nothing at
 * all, while the articles it wanted were sitting in a row that had just been
 * declared too old. An hour-old headline beats no headline.
 */
const CORPUS_TTL_SECONDS = 3600;
const REFRESH_AFTER_SECONDS = 150;

/** Cap on the cold path, where nothing is cached and the caller is waiting. */
const COLD_FETCH_TIMEOUT_MS = 1500;
/** The background refresh has nobody waiting on it, so it can be patient. */
const WARM_FETCH_TIMEOUT_MS = 4000;

const CORPUS_LOOKUP = { namespace: "newsroom", query: "corpus", locale: "all" };

function decodeEntities(text: string): string {
  return text
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        hellip: "…",
        rsquo: "’",
        lsquo: "‘",
        ldquo: "“",
        rdquo: "”",
        mdash: "—",
        ndash: "–",
      };
      return named[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match =
    block.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i")) ?? null;
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, " ")) : "";
}

/** Parses RSS and Atom alike: the feeds listed above are a mix of both. */
function parseFeed(body: string, feed: Feed): NewsItem[] {
  const blocks = [...body.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map((m) => m[0]);
  const items: NewsItem[] = [];

  for (const block of blocks) {
    const title = tag(block, "title");
    const link =
      block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ??
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      (tag(block, "link") ||
        block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:[\s\S]*?)(?:\]\]>)?<\/guid>/i)?.[1] ||
        "");
    if (!title || !link) continue;

    const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date");
    const parsed = published ? Date.parse(published) : NaN;

    items.push({
      title,
      url: decodeEntities(link).split("?")[0],
      snippet: (tag(block, "description") || tag(block, "summary") || tag(block, "content")).slice(0, 400),
      publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
      source: feed.name,
      lang: feed.lang,
    });
  }

  return items;
}

async function pullFeed(feed: Feed, timeoutMs: number): Promise<NewsItem[]> {
  try {
    const res = await safeFetch(feed.url, { trusted: true, timeoutMs });
    if (res.status >= 400) return [];
    return parseFeed(res.body, feed).slice(0, 40);
  } catch {
    // One dead feed is a smaller corpus, never a failed search.
    return [];
  }
}

async function pullAll(timeoutMs: number): Promise<NewsItem[]> {
  const pulled = await Promise.all(FEEDS.map((feed) => pullFeed(feed, timeoutMs)));
  const seen = new Set<string>();
  const corpus: NewsItem[] = [];

  for (const items of pulled) {
    for (const item of items) {
      const key = item.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      corpus.push(item);
    }
  }

  corpus.sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"));
  return corpus;
}

/**
 * Returns the corpus, refreshing it behind the caller rather than in front of
 * them. A slightly stale headline served in a millisecond beats a current one
 * served in half a second, and the refresh that keeps it current runs after
 * the response has already gone out.
 */
export async function newsCorpus(options: { blocking?: boolean } = {}): Promise<NewsItem[]> {
  const cached = await cacheGet<NewsItem[]>(CORPUS_LOOKUP);

  if (cached && cached.payload.length > 0) {
    if (cached.ageSeconds >= REFRESH_AFTER_SECONDS) {
      offload(async () => {
        const fresh = await pullAll(WARM_FETCH_TIMEOUT_MS);
        if (fresh.length > 0) await cacheSet(CORPUS_LOOKUP, fresh, CORPUS_TTL_SECONDS);
      });
    }
    return cached.payload;
  }

  // Cold, and nobody asked for news specifically. Measured: a general search
  // for "postgres index bloat" paid a full corpus pull for a source that was
  // never going to answer it. A search gets the corpus if it is there and
  // nothing at all if it is not — the pull happens after the response instead.
  if (!options.blocking) {
    offload(async () => {
      const fresh = await pullAll(WARM_FETCH_TIMEOUT_MS);
      if (fresh.length > 0) await cacheSet(CORPUS_LOOKUP, fresh, CORPUS_TTL_SECONDS);
    });
    return [];
  }

  // Awaited rather than offloaded: this path runs for a request that asked for
  // news and is waiting on it, and work handed to `after()` here would be
  // scheduled after the response that needed it.
  const corpus = await pullAll(COLD_FETCH_TIMEOUT_MS);
  if (corpus.length > 0) await cacheSet(CORPUS_LOOKUP, corpus, CORPUS_TTL_SECONDS);
  return corpus;
}

/** Forces a corpus refresh; used by the warm-up cron. */
export async function refreshNewsCorpus(): Promise<number> {
  const corpus = await pullAll(WARM_FETCH_TIMEOUT_MS);
  if (corpus.length > 0) await cacheSet(CORPUS_LOOKUP, corpus, CORPUS_TTL_SECONDS);
  return corpus.length;
}

const TR_SUFFIXES = /(lar|ler|ları|leri|ında|inde|dan|den|tan|ten|nın|nin|nun|nün|ya|ye|da|de|ta|te|ı|i|u|ü)$/;

/** Crude stem, enough to make "ekonomisi" match "ekonomi" in a headline. */
function stem(word: string): string {
  const lower = word.toLocaleLowerCase("tr");
  if (lower.length <= 4) return lower;
  return lower.replace(TR_SUFFIXES, "");
}

function terms(query: string): string[] {
  return query
    .split(/\s+/)
    .map(stem)
    .filter((t) => t.length >= 3);
}

/**
 * Matches the query against the corpus. Headline hits count for more than body
 * hits, and among equally matching stories the newer one wins — in news,
 * recency is part of relevance rather than a filter applied after it.
 */
export function matchNews(
  corpus: NewsItem[],
  query: string,
  limit: number,
  freshnessHours?: number | null
): NewsItem[] {
  const wanted = terms(query);
  const cutoff = freshnessHours != null ? Date.now() - freshnessHours * 3_600_000 : null;

  const scored: { item: NewsItem; score: number }[] = [];

  for (const item of corpus) {
    if (cutoff != null && item.publishedAt) {
      const ts = Date.parse(item.publishedAt);
      if (!Number.isNaN(ts) && ts < cutoff) continue;
    }

    const title = item.title.toLocaleLowerCase("tr");
    const body = item.snippet.toLocaleLowerCase("tr");

    let hits = 0;
    let score = 0;
    for (const term of wanted) {
      if (title.includes(term)) {
        hits += 1;
        score += 1;
      } else if (body.includes(term)) {
        hits += 1;
        score += 0.4;
      }
    }

    // A headline sharing one word out of five with the question is not about
    // the question. Measured: "artificial intelligence" matched a piece on
    // military intelligence on the strength of the second word alone, so a
    // short query has to match in full and a long one in most of its terms.
    const required = Math.min(wanted.length, Math.max(2, Math.ceil(wanted.length * 0.6)));
    if (wanted.length > 0 && hits < required) continue;

    // Recency as a tie-breaker within the last week, not as a veto.
    const age = item.publishedAt ? (Date.now() - Date.parse(item.publishedAt)) / 3_600_000 : 72;
    score += Math.max(0, 1 - age / 168) * 0.5;

    scored.push({ item, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

export function asRawResults(items: NewsItem[]): RawResult[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    publishedAt: item.publishedAt ?? undefined,
    source: `newsroom:${item.source}`,
  }));
}
