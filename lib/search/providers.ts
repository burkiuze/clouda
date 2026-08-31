import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/core/http";
import { CloudaError } from "@/lib/core/errors";
import { RawResult } from "@/lib/search/types";

/**
 * Discovery providers.
 *
 * Two classes exist. Keyed providers (Tavily, Brave, Serper) are the
 * dependable path and are tried first when their key is configured. Open
 * providers need no key but each covers only a slice of the web, so they are
 * queried together and merged rather than one at a time — measured from cloud
 * IP ranges, the general-web scrapers are blocked outright, which is why they
 * sit at the end of the chain rather than the front.
 */

export interface Provider {
  name: string;
  /** "keyed" providers are tried alone; "open" providers are merged. */
  kind: "keyed" | "open";
  /** False when the provider's credentials are absent. */
  available(): boolean;
  search(query: string, limit: number, locale: string, freshnessHours?: number | null): Promise<RawResult[]>;
}

const PROVIDER_TIMEOUT = 7000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await safeFetch(url, { ...init, trusted: true, timeoutMs: PROVIDER_TIMEOUT });
    if (res.status >= 400) return null;
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ keyed */

const tavily: Provider = {
  name: "tavily",
  kind: "keyed",
  available: () => Boolean(process.env.TAVILY_API_KEY),
  async search(query, limit, _locale, freshnessHours) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return [];

    // Tavily expresses recency in whole days.
    const days = freshnessHours != null ? Math.max(1, Math.ceil(freshnessHours / 24)) : undefined;

    const data = await getJson<{
      results?: { title?: string; url?: string; content?: string; published_date?: string }[];
    }>("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: limit,
        search_depth: "basic",
        include_answer: false,
        ...(days ? { days, topic: "news" } : {}),
      }),
    });

    return (data?.results ?? [])
      .filter((r) => r.title && r.url)
      .slice(0, limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: r.content ?? "",
        publishedAt: r.published_date ?? null,
      }));
  },
};

const brave: Provider = {
  name: "brave",
  kind: "keyed",
  available: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  async search(query, limit, locale, freshnessHours) {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) return [];

    const [lang, region] = locale.split("-");
    // Brave takes a coarse recency bucket rather than an exact window.
    const freshness =
      freshnessHours == null
        ? ""
        : freshnessHours <= 24
          ? "&freshness=pd"
          : freshnessHours <= 24 * 7
            ? "&freshness=pw"
            : freshnessHours <= 24 * 31
              ? "&freshness=pm"
              : "&freshness=py";

    const data = await getJson<{
      web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] };
    }>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
        `&count=${limit}&safesearch=strict&search_lang=${lang}${region ? `&country=${region}` : ""}${freshness}`,
      { headers: { Accept: "application/json", "X-Subscription-Token": key } }
    );

    return (data?.web?.results ?? [])
      .filter((r) => r.title && r.url)
      .slice(0, limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: r.description ?? "",
        publishedAt: r.age ?? null,
      }));
  },
};

const serper: Provider = {
  name: "serper",
  kind: "keyed",
  available: () => Boolean(process.env.SERPER_API_KEY),
  async search(query, limit, locale, freshnessHours) {
    const key = process.env.SERPER_API_KEY;
    if (!key) return [];

    const [lang, region] = locale.split("-");
    const tbs =
      freshnessHours == null
        ? undefined
        : freshnessHours <= 1
          ? "qdr:h"
          : freshnessHours <= 24
            ? "qdr:d"
            : freshnessHours <= 24 * 7
              ? "qdr:w"
              : freshnessHours <= 24 * 31
                ? "qdr:m"
                : "qdr:y";

    const data = await getJson<{
      organic?: { title?: string; link?: string; snippet?: string; date?: string }[];
    }>("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({
        q: query,
        num: limit,
        hl: lang,
        gl: region?.toLowerCase(),
        ...(tbs ? { tbs } : {}),
      }),
    });

    return (data?.organic ?? [])
      .filter((r) => r.title && r.link)
      .slice(0, limit)
      .map((r) => ({
        title: r.title as string,
        url: r.link as string,
        snippet: r.snippet ?? "",
        publishedAt: r.date ?? null,
      }));
  },
};

/* ------------------------------------------------------------------- open */

function resolveDuckUrl(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return href;
  }
}

const duckduckgo: Provider = {
  name: "duckduckgo",
  kind: "open",
  available: () => true,
  async search(query, limit) {
    try {
      const res = await safeFetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        trusted: true,
        timeoutMs: PROVIDER_TIMEOUT,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: query }).toString(),
      });

      const $ = cheerio.load(res.body);
      const out: RawResult[] = [];
      $(".result").each((_, el) => {
        if (out.length >= limit) return;
        const link = $(el).find(".result__a").first();
        const title = link.text().trim();
        const href = link.attr("href");
        if (!title || !href) return;
        const url = resolveDuckUrl(href);
        if (!/^https?:\/\//.test(url)) return;
        out.push({ title, url, snippet: $(el).find(".result__snippet").text().trim() });
      });
      return out;
    } catch {
      // Datacenter ranges usually get the bot-check page here.
      return [];
    }
  },
};

const wikipedia: Provider = {
  name: "wikipedia",
  kind: "open",
  available: () => true,
  async search(query, limit, locale) {
    const primary = locale.split("-")[0] || "en";
    const langs = primary === "en" ? ["en"] : [primary, "en"];
    const out: RawResult[] = [];

    for (const lang of langs) {
      if (out.length >= limit) break;
      const data = await getJson<{
        query?: { search?: { title: string; snippet: string; timestamp?: string }[] };
      }>(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query
        )}&format=json&srlimit=${limit}`,
        { headers: { "User-Agent": "Clouda/1.0 (https://clouda.dev)" } }
      );

      for (const hit of data?.query?.search ?? []) {
        if (out.length >= limit) break;
        out.push({
          title: hit.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
          snippet: hit.snippet.replace(/<[^>]+>/g, "").trim(),
          publishedAt: hit.timestamp ?? null,
        });
      }
    }
    return out;
  },
};

const stackoverflow: Provider = {
  name: "stackoverflow",
  kind: "open",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      items?: { title?: string; link?: string; creation_date?: number; last_activity_date?: number }[];
    }>(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
        query
      )}&site=stackoverflow&pagesize=${limit}`
    );

    return (data?.items ?? [])
      .filter((i) => i.title && i.link)
      .slice(0, limit)
      .map((i) => ({
        title: i.title as string,
        url: i.link as string,
        snippet: "",
        publishedAt: i.last_activity_date
          ? new Date(i.last_activity_date * 1000).toISOString()
          : null,
      }));
  },
};

const github: Provider = {
  name: "github",
  kind: "open",
  available: () => true,
  async search(query, limit) {
    const token = process.env.GITHUB_TOKEN;
    const data = await getJson<{
      items?: { full_name?: string; html_url?: string; description?: string; pushed_at?: string }[];
    }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return (data?.items ?? [])
      .filter((r) => r.full_name && r.html_url)
      .slice(0, limit)
      .map((r) => ({
        title: r.full_name as string,
        url: r.html_url as string,
        snippet: r.description ?? "",
        publishedAt: r.pushed_at ?? null,
      }));
  },
};

const hackernews: Provider = {
  name: "hackernews",
  kind: "open",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      hits?: { title?: string; url?: string; objectID?: string; created_at?: string; story_text?: string }[];
    }>(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}`
    );

    return (data?.hits ?? [])
      .filter((h) => h.title)
      .slice(0, limit)
      .map((h) => ({
        title: h.title as string,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: (h.story_text ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
        publishedAt: h.created_at ?? null,
      }));
  },
};

const crossref: Provider = {
  name: "crossref",
  kind: "open",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      message?: { items?: { title?: string[]; URL?: string; abstract?: string; created?: { "date-time"?: string } }[] };
    }>(
      `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=title,URL,abstract,created`,
      { headers: { "User-Agent": "Clouda/1.0 (mailto:hello@clouda.dev)" } }
    );

    return (data?.message?.items ?? [])
      .filter((w) => w.title?.[0] && w.URL)
      .slice(0, limit)
      .map((w) => ({
        title: (w.title as string[])[0],
        url: w.URL as string,
        snippet: (w.abstract ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
        publishedAt: w.created?.["date-time"] ?? null,
      }));
  },
};

const googleNews: Provider = {
  name: "google-news",
  kind: "open",
  available: () => true,
  async search(query, limit, locale) {
    const [lang, region = lang.toUpperCase()] = locale.split("-");
    try {
      const res = await safeFetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${region}&ceid=${region}:${lang}`,
        { trusted: true, timeoutMs: PROVIDER_TIMEOUT }
      );

      const $ = cheerio.load(res.body, { xml: true });
      const out: RawResult[] = [];
      $("item").each((_, el) => {
        if (out.length >= limit) return;
        const title = $(el).find("title").first().text().trim();
        const url = $(el).find("link").first().text().trim();
        if (!title || !/^https?:\/\//.test(url)) return;
        out.push({
          title,
          url,
          snippet: $(el).find("description").first().text().replace(/<[^>]+>/g, "").trim(),
          publishedAt: $(el).find("pubDate").first().text().trim() || null,
        });
      });
      return out;
    } catch {
      return [];
    }
  },
};

export const KEYED_PROVIDERS: Provider[] = [tavily, brave, serper];
export const OPEN_PROVIDERS: Provider[] = [
  duckduckgo,
  wikipedia,
  stackoverflow,
  github,
  hackernews,
  crossref,
  googleNews,
];

export const ALL_PROVIDERS = [...KEYED_PROVIDERS, ...OPEN_PROVIDERS];

export function configuredKeyedProvider(): Provider | null {
  return KEYED_PROVIDERS.find((p) => p.available()) ?? null;
}

export function hasKeyedProvider(): boolean {
  return configuredKeyedProvider() !== null;
}

/**
 * Open providers each cover one domain of the web, so a general question is
 * answered by asking several and interleaving what comes back. Intent narrows
 * the set: a news question should not be answered by Crossref.
 */
export function openProvidersForIntent(intent: string): Provider[] {
  switch (intent) {
    case "news":
    case "finance":
      return [duckduckgo, googleNews, wikipedia];
    case "academic":
      return [duckduckgo, crossref, wikipedia];
    case "technical":
      return [duckduckgo, stackoverflow, github, hackernews];
    case "product":
      return [duckduckgo, googleNews, hackernews];
    default:
      return OPEN_PROVIDERS;
  }
}

export function providerUnavailable(name: string): CloudaError {
  return new CloudaError("provider_failed", `Sağlayıcı yanıt vermedi: ${name}`, { provider: name });
}
