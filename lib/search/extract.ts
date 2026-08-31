import * as cheerio from "cheerio";
import { safeFetch, FetchResult } from "@/lib/core/http";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * Turns a fetched page into the two things a model actually needs: readable
 * text with the furniture stripped out, and the dates the page claims for
 * itself so freshness can be scored rather than guessed.
 */

export interface ExtractedPage {
  url: string;
  title: string;
  content: string;
  publishedAt: string | null;
  updatedAt: string | null;
  /** Outbound links, used by the browser agent to navigate. */
  links: { text: string; url: string }[];
  bytes: number;
}

const CONTENT_LIMIT = 4000;

/** Meta tags and microdata that carry publication dates, in order of trust. */
const PUBLISHED_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[name="article:published_time"]',
  'meta[property="og:published_time"]',
  'meta[name="publish-date"]',
  'meta[name="pubdate"]',
  'meta[name="date"]',
  'meta[itemprop="datePublished"]',
];

const MODIFIED_SELECTORS = [
  'meta[property="article:modified_time"]',
  'meta[name="lastmod"]',
  'meta[itemprop="dateModified"]',
  'meta[property="og:updated_time"]',
];

function metaDate($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = $(selector).attr("content") ?? $(selector).attr("datetime");
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

/** JSON-LD is where most modern publishers put the real dates. */
function jsonLdDates($: cheerio.CheerioAPI): { published: string | null; modified: string | null } {
  let published: string | null = null;
  let modified: string | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (published && modified) return;
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const p = node.datePublished ?? node.dateCreated;
        const m = node.dateModified;
        if (!published && typeof p === "string" && !Number.isNaN(Date.parse(p))) {
          published = new Date(p).toISOString();
        }
        if (!modified && typeof m === "string" && !Number.isNaN(Date.parse(m))) {
          modified = new Date(m).toISOString();
        }
      }
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  });

  return { published, modified };
}

function readableText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, nav, header, footer, aside, svg, form, iframe, template").remove();

  // Prefer an explicit article container when the page marks one.
  const container = $("article").first().length ? $("article").first() : $("body");

  const blocks: string[] = [];
  container.find("p, li, h1, h2, h3, h4, blockquote, td").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 40) blocks.push(text);
  });

  if (blocks.length === 0) {
    return container.text().replace(/\s+/g, " ").trim().slice(0, CONTENT_LIMIT);
  }

  // De-duplicate repeated boilerplate lines (cookie notices, nav labels).
  const seen = new Set<string>();
  const unique = blocks.filter((b) => {
    const key = b.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.join("\n").slice(0, CONTENT_LIMIT);
}

export function parsePage(res: FetchResult): ExtractedPage {
  const $ = cheerio.load(res.body);

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    new URL(res.url).hostname;

  const ld = jsonLdDates($);
  const published = metaDate($, PUBLISHED_SELECTORS) ?? ld.published;
  const modified = metaDate($, MODIFIED_SELECTORS) ?? ld.modified;

  const links: { text: string; url: string }[] = [];
  const seenLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    if (links.length >= 60) return;
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !text || text.length > 120) return;
    try {
      const abs = new URL(href, res.url).toString();
      if (!/^https?:/.test(abs) || seenLinks.has(abs)) return;
      seenLinks.add(abs);
      links.push({ text, url: abs });
    } catch {
      // Skip unparseable hrefs.
    }
  });

  return {
    url: res.url,
    title,
    content: readableText($),
    publishedAt: published,
    updatedAt: modified,
    links,
    bytes: res.bytes,
  };
}

/** Fetches and extracts a page, returning null when it cannot be read. */
export async function fetchAndExtract(
  url: string,
  options: { policy?: DomainPolicy; timeoutMs?: number } = {}
): Promise<ExtractedPage | null> {
  try {
    const res = await safeFetch(url, {
      policy: options.policy,
      timeoutMs: options.timeoutMs ?? 3500,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.contentType.includes("html") && !res.contentType.includes("text/plain")) return null;
    return parsePage(res);
  } catch {
    return null;
  }
}
