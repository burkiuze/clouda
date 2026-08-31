import * as cheerio from "cheerio";

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

type Discovery = (query: string, maxResults: number) => Promise<SearchResult[]>;

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

/** Bing publishes an RSS view of its result page, which datacenter IPs can read. */
const bingRss: Discovery = async (query, maxResults) => {
  const xml = await getText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${maxResults * 2}`
  );
  return xml ? parseRss(xml, maxResults) : [];
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
const googleNewsRss: Discovery = async (query, maxResults) => {
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`
  );
  return xml ? parseRss(xml, maxResults) : [];
};

/** Last resort: an encyclopaedic answer beats an empty response. */
const wikipedia: Discovery = async (query, maxResults) => {
  const out: SearchResult[] = [];
  for (const lang of ["tr", "en"]) {
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

// Ordered by result quality, and by which sources actually answer from cloud
// IP ranges: DuckDuckGo serves its bot-check page to datacenter addresses, so
// it sits behind Bing rather than in front of it.
const sources: { name: string; discover: Discovery }[] = [
  { name: "bing-rss", discover: bingRss },
  { name: "ddg-html", discover: duckDuckGoHtml },
  { name: "ddg-lite", discover: duckDuckGoLite },
  { name: "wikipedia", discover: wikipedia },
  { name: "google-news-rss", discover: googleNewsRss },
];

async function discoverResults(
  query: string,
  maxResults: number
): Promise<{ results: SearchResult[]; source: string }> {
  for (const source of sources) {
    const results = await source.discover(query, maxResults);
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
  { maxResults = 5 }: { maxResults?: number } = {}
): Promise<SearchResponse> {
  const start = Date.now();
  const { results, source } = await discoverResults(query, maxResults);

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
