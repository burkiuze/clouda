import * as cheerio from "cheerio";
import { filterUnsafe } from "@/lib/search/safety";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  tookMs: number;
  /** Which discovery source answered, useful when debugging upstream blocks. */
  source: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 1_500_000;
const CONTENT_TRUNCATE = 2000;

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function getText(url: string, init?: RequestInit): Promise<string | null> {
  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
      signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/**
 * Resolves redirect-wrapped result URLs (//duckduckgo.com/l/?uddg=...) down to
 * the real destination.
 */
function resolveResultUrl(href: string, base = "https://duckduckgo.com"): string {
  try {
    const url = new URL(href, base);
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

/** BCP-47 market used to steer result language and region. */
export const DEFAULT_LOCALE = "tr-TR";

type Discovery = (query: string, maxResults: number, locale: string) => Promise<SearchResult[]>;

const duckDuckGoHtml: Discovery = async (query, maxResults) => {
  const html = await getText("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, el) => {
    if (results.length >= maxResults) return;
    const titleEl = $(el).find(".result__a").first();
    const title = titleEl.text().trim();
    const rawHref = titleEl.attr("href");
    if (!title || !rawHref) return;
    const url = resolveResultUrl(rawHref);
    if (!/^https?:\/\//.test(url)) return;
    results.push({
      title,
      url,
      snippet: $(el).find(".result__snippet").text().trim(),
      content: "",
    });
  });
  return results;
};

const duckDuckGoLite: Discovery = async (query, maxResults) => {
  const html = await getText("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $("a.result-link").each((_, el) => {
    if (results.length >= maxResults) return;
    const title = $(el).text().trim();
    const rawHref = $(el).attr("href");
    if (!title || !rawHref) return;
    const url = resolveResultUrl(rawHref);
    if (!/^https?:\/\//.test(url)) return;
    results.push({
      title,
      url,
      snippet: $(el).closest("tr").next("tr").find(".result-snippet").text().trim(),
      content: "",
    });
  });
  return results;
};

/**
 * Keyed providers. Every free scraping route is blocked from cloud IP ranges
 * (DuckDuckGo and Mojeek serve bot checks, Brave rate-limits, Bing's RSS view
 * answers with results unrelated to the query), so a provider key is what makes
 * general web search dependable in production. Whichever key is configured is
 * tried first; without one the engine falls back to the open sources below.
 */
const tavily: Discovery = async (query, maxResults) => {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const body = await getText("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
  });
  if (!body) return [];
  try {
    const data = JSON.parse(body) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (data.results ?? [])
      .filter((r): r is { title: string; url: string; content?: string } =>
        Boolean(r.title && r.url)
      )
      .slice(0, maxResults)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "", content: "" }));
  } catch {
    return [];
  }
};

const brave: Discovery = async (query, maxResults, locale) => {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const [lang, region] = locale.split("-");
  const body = await getText(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}` +
      `&safesearch=strict&search_lang=${lang}${region ? `&country=${region}` : ""}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": key } }
  );
  if (!body) return [];
  try {
    const data = JSON.parse(body) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (data.web?.results ?? [])
      .filter((r): r is { title: string; url: string; description?: string } =>
        Boolean(r.title && r.url)
      )
      .slice(0, maxResults)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "", content: "" }));
  } catch {
    return [];
  }
};

const serper: Discovery = async (query, maxResults, locale) => {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const [lang, region] = locale.split("-");
  const body = await getText("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: query, num: maxResults, hl: lang, gl: region?.toLowerCase() }),
  });
  if (!body) return [];
  try {
    const data = JSON.parse(body) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };
    return (data.organic ?? [])
      .filter((r): r is { title: string; link: string; snippet?: string } =>
        Boolean(r.title && r.link)
      )
      .slice(0, maxResults)
      .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "", content: "" }));
  } catch {
    return [];
  }
};

function parseRss(xml: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(xml, { xml: true });
  const results: SearchResult[] = [];
  $("item").each((_, el) => {
    if (results.length >= maxResults) return;
    const title = $(el).find("title").first().text().trim();
    const url = $(el).find("link").first().text().trim();
    if (!title || !/^https?:\/\//.test(url)) return;
    results.push({
      title,
      url,
      snippet: $(el).find("description").first().text().replace(/<[^>]+>/g, "").trim(),
      content: "",
    });
  });
  return results;
}

/** News-shaped queries still deserve an answer when the general sources fail. */
const googleNewsRss: Discovery = async (query, maxResults, locale) => {
  const [lang, region = lang.toUpperCase()] = locale.split("-");
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=${lang}&gl=${region}&ceid=${region}:${lang}`
  );
  return xml ? parseRss(xml, maxResults) : [];
};

/** Last resort: an encyclopaedic answer beats an empty response. */
const wikipedia: Discovery = async (query, maxResults, locale) => {
  const primaryLang = locale.split("-")[0] || "en";
  const langs = primaryLang === "en" ? ["en"] : [primaryLang, "en"];
  const out: SearchResult[] = [];
  for (const lang of langs) {
    if (out.length >= maxResults) break;
    const json = await getText(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        query
      )}&format=json&srlimit=${maxResults}`,
      { headers: { "User-Agent": "Clouda/0.1 (web search API; hello@clouda.dev)" } }
    );
    if (!json) continue;
    try {
      const data = JSON.parse(json) as {
        query?: { search?: { title: string; snippet: string }[] };
      };
      for (const hit of data.query?.search ?? []) {
        if (out.length >= maxResults) break;
        out.push({
          title: hit.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
          snippet: hit.snippet.replace(/<[^>]+>/g, "").trim(),
          content: "",
        });
      }
    } catch {
      // try the next language
    }
  }
  return out;
};

// Keyed providers first (they no-op when their key is absent), then the open
// sources. DuckDuckGo stays in the chain because it works from hosts outside
// the cloud IP ranges it blocks; Wikipedia and Google News are the last resort
// so an unkeyed deployment still answers encyclopaedic and news queries.
const sources: { name: string; discover: Discovery }[] = [
  { name: "tavily", discover: tavily },
  { name: "brave", discover: brave },
  { name: "serper", discover: serper },
  { name: "ddg-html", discover: duckDuckGoHtml },
  { name: "ddg-lite", discover: duckDuckGoLite },
  { name: "wikipedia", discover: wikipedia },
  { name: "google-news-rss", discover: googleNewsRss },
];

export const hasSearchProviderKey = Boolean(
  process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY || process.env.SERPER_API_KEY
);

async function discoverResults(
  query: string,
  maxResults: number,
  locale: string
): Promise<{ results: SearchResult[]; source: string }> {
  for (const source of sources) {
    const results = filterUnsafe(await source.discover(query, maxResults, locale));
    if (results.length > 0) return { results, source: source.name };
  }
  return { results: [], source: "none" };
}

function extractReadableText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, nav, header, footer, svg, form, iframe").remove();
  const paragraphs: string[] = [];
  $("p, li, h1, h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 40) paragraphs.push(text);
  });
  if (paragraphs.length === 0) {
    return $("body").text().replace(/\s+/g, " ").trim().slice(0, CONTENT_TRUNCATE);
  }
  return paragraphs.join("\n").slice(0, CONTENT_TRUNCATE);
}

async function fetchPageContent(url: string): Promise<string> {
  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal,
    });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return "";

    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_PAGE_BYTES) break;
        chunks.push(value);
      }
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    return extractReadableText(cheerio.load(html));
  } catch {
    return "";
  } finally {
    cancel();
  }
}

/**
 * Clouda's own web-search pipeline: discovery across several independent
 * sources (so one blocking our IP range doesn't take the product down),
 * followed by a server-side fetch and readability pass so callers get usable
 * page content rather than bare snippets. No third-party paid API required.
 */
export async function searchWeb(
  query: string,
  {
    maxResults = 5,
    locale = DEFAULT_LOCALE,
  }: { maxResults?: number; locale?: string } = {}
): Promise<SearchResponse> {
  const start = Date.now();
  const { results, source } = await discoverResults(query, maxResults, locale);

  const withContent = await Promise.all(
    results.map(async (result) => {
      const content = await fetchPageContent(result.url);
      return { ...result, content: content || result.snippet };
    })
  );

  return {
    query,
    results: withContent,
    tookMs: Date.now() - start,
    source,
  };
}
