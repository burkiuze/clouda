import { safeFetch } from "@/lib/core/http";
import { CloudaError } from "@/lib/core/errors";
import { assertUrlAllowed, DomainPolicy, hostMatches } from "@/lib/core/security";

/**
 * Discovers the URLs a site publishes about itself.
 *
 * An agent asked to "read the docs for X" has one URL and needs the other
 * three hundred. Crawling to find them is slow, rude, and mostly rediscovers
 * what the site already lists — every serious site publishes a sitemap and
 * points at it from robots.txt precisely so machines do not have to guess.
 *
 * So this asks in the order the site itself intends: robots.txt for the
 * sitemap directives, then the sitemaps (following index files one level),
 * and only if none of that yields anything, the page's own links. The last one
 * is the fallback, not the plan.
 */

const FETCH_TIMEOUT_MS = 5000;
/** Sitemap index files point at more sitemaps; this bounds how many we open. */
const MAX_CHILD_SITEMAPS = 8;
const MAX_URLS = 5000;

export interface DiscoveredUrl {
  url: string;
  /** From the sitemap, when the site declares one. */
  lastModified: string | null;
  /** How we came to know about it. */
  via: "sitemap" | "links";
}

export interface SiteMap {
  site: string;
  urls: DiscoveredUrl[];
  /** Sitemaps actually read, so a caller can verify where this came from. */
  sitemaps: string[];
  robotsFound: boolean;
  truncated: boolean;
}

function origin(input: string): URL {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new CloudaError("invalid_url", `Geçersiz adres: ${input.slice(0, 120)}`);
  }
}

async function get(url: string, policy?: DomainPolicy): Promise<string | null> {
  try {
    assertUrlAllowed(url, policy);
    const res = await safeFetch(url, { policy, timeoutMs: FETCH_TIMEOUT_MS });
    if (res.status >= 400) return null;
    return res.body;
  } catch {
    return null;
  }
}

/** Sitemap directives in robots.txt, which is where a site declares them. */
function sitemapsFromRobots(body: string, base: URL): string[] {
  return [...body.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)]
    .map((match) => {
      try {
        return new URL(match[1], base).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => url !== null);
}

interface ParsedSitemap {
  urls: { url: string; lastModified: string | null }[];
  /** Present when the document is an index pointing at other sitemaps. */
  children: string[];
}

function parseSitemap(body: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(body);

  const entries = [...body.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const urls: ParsedSitemap["urls"] = [];
  const children: string[] = [];

  for (const entry of entries) {
    const loc = entry.match(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i)?.[1]?.trim();
    if (!loc) continue;

    if (isIndex) {
      children.push(loc);
      continue;
    }

    const lastmod = entry.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null;
    const parsed = lastmod ? Date.parse(lastmod) : NaN;
    urls.push({
      url: loc,
      lastModified: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    });
  }

  // A plain-text sitemap is one URL per line, and is legal.
  if (urls.length === 0 && children.length === 0 && !/[<>]/.test(body.slice(0, 200))) {
    for (const line of body.split("\n").map((l) => l.trim())) {
      if (/^https?:\/\/\S+$/.test(line)) urls.push({ url: line, lastModified: null });
    }
  }

  return { urls, children };
}

/** Same-site links off a page, as the fallback when no sitemap exists. */
function linksFromPage(body: string, base: URL): string[] {
  const found = new Set<string>();

  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (!hostMatches(url.hostname, base.hostname)) continue;
      url.hash = "";
      found.add(url.toString());
    } catch {
      // An unparseable href is not a link.
    }
    if (found.size >= 300) break;
  }

  return [...found];
}

export interface MapOptions {
  limit?: number;
  /** Keep only URLs whose path contains this, e.g. "/docs/". */
  pathPrefix?: string;
  policy?: DomainPolicy;
}

export async function mapSite(input: string, options: MapOptions = {}): Promise<SiteMap> {
  const base = origin(input);
  assertUrlAllowed(base.toString(), options.policy);

  const limit = Math.min(options.limit ?? 200, MAX_URLS);
  const seen = new Map<string, DiscoveredUrl>();
  const read: string[] = [];

  const robots = await get(new URL("/robots.txt", base).toString(), options.policy);
  const declared = robots ? sitemapsFromRobots(robots, base) : [];

  // A site that declares nothing usually still has the conventional path.
  const candidates = declared.length > 0 ? declared : [new URL("/sitemap.xml", base).toString()];

  const queue = [...candidates];
  let opened = 0;

  while (queue.length > 0 && seen.size < limit && opened < MAX_CHILD_SITEMAPS + candidates.length) {
    const target = queue.shift() as string;
    opened += 1;

    const body = await get(target, options.policy);
    if (!body) continue;
    read.push(target);

    const parsed = parseSitemap(body);

    // An index is followed one level, newest first: a site that splits its
    // sitemap by date puts what changed recently in the last file, and that is
    // the part a caller asking for 200 URLs actually wants.
    for (const child of parsed.children.slice(-MAX_CHILD_SITEMAPS).reverse()) {
      if (queue.length < MAX_CHILD_SITEMAPS) queue.push(child);
    }

    for (const entry of parsed.urls) {
      if (seen.size >= limit) break;
      if (seen.has(entry.url)) continue;
      seen.set(entry.url, { url: entry.url, lastModified: entry.lastModified, via: "sitemap" });
    }
  }

  // Only now, and only if the site told us nothing.
  if (seen.size === 0) {
    const page = await get(base.toString(), options.policy);
    if (page) {
      for (const url of linksFromPage(page, base)) {
        if (seen.size >= limit) break;
        seen.set(url, { url, lastModified: null, via: "links" });
      }
    }
  }

  let urls = [...seen.values()];

  if (options.pathPrefix) {
    const needle = options.pathPrefix.toLowerCase();
    const filtered = urls.filter((entry) => {
      try {
        return new URL(entry.url).pathname.toLowerCase().includes(needle);
      } catch {
        return false;
      }
    });
    // A filter matching nothing is more likely a typo than a site with no such
    // section, so the unfiltered list is returned rather than an empty one —
    // and the counts in the response make the difference visible.
    if (filtered.length > 0) urls = filtered;
  }

  // Most recently changed first where the site says so, then shortest path: a
  // section's index page is usually the one worth reading first.
  urls.sort((a, b) => {
    if (a.lastModified && b.lastModified) return b.lastModified.localeCompare(a.lastModified);
    if (a.lastModified) return -1;
    if (b.lastModified) return 1;
    return a.url.length - b.url.length;
  });

  return {
    site: base.origin,
    urls: urls.slice(0, limit),
    sitemaps: read,
    robotsFound: robots !== null,
    truncated: seen.size >= limit,
  };
}
