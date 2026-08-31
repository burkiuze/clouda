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

/**
 * Resolves DuckDuckGo's redirect-wrapped result URLs (//duckduckgo.com/l/?uddg=...)
 * down to the real destination URL.
 */
function resolveResultUrl(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

async function fetchSerp(query: string, maxResults: number): Promise<SearchResult[]> {
  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];
    $(".result").each((_, el) => {
      if (results.length >= maxResults) return;
      const titleEl = $(el).find(".result__a").first();
      const title = titleEl.text().trim();
      const rawHref = titleEl.attr("href");
      const snippet = $(el).find(".result__snippet").text().trim();
      if (!title || !rawHref) return;
      const url = resolveResultUrl(rawHref);
      if (!/^https?:\/\//.test(url)) return;
      results.push({ title, url, snippet, content: "" });
    });
    return results;
  } catch {
    return [];
  } finally {
    cancel();
  }
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
    const $ = cheerio.load(html);
    return extractReadableText($);
  } catch {
    return "";
  } finally {
    cancel();
  }
}

/**
 * Clouda's own web-search pipeline: meta-search over DuckDuckGo's HTML
 * endpoint for result discovery, then a server-side fetch + readability
 * extraction pass so callers get usable page content, not just snippets.
 * No third-party paid search API required.
 */
export async function searchWeb(
  query: string,
  { maxResults = 5 }: { maxResults?: number } = {}
): Promise<SearchResponse> {
  const start = Date.now();
  const serp = await fetchSerp(query, maxResults);

  const withContent = await Promise.all(
    serp.map(async (result) => {
      const content = await fetchPageContent(result.url);
      return { ...result, content: content || result.snippet };
    })
  );

  return {
    query,
    results: withContent,
    tookMs: Date.now() - start,
  };
}
