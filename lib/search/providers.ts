import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/core/http";
import { CloudaError } from "@/lib/core/errors";
import { RawResult } from "@/lib/search/types";

/**
 * Discovery providers — all of them open, none of them keyed.
 *
 * Which sources are listed here was decided by measurement from the
 * deployment's own egress, not by reputation. From a datacenter range the
 * mainstream scrapers are simply gone: DuckDuckGo's HTML endpoint returns the
 * bot-check page, and Mojeek, Reddit, Lobsters and searchmysite all answer 403.
 * They are not listed, because a provider that never answers still costs every
 * query a timeout.
 *
 * Marginalia and mwmbl are the general-web indexes — the only two measured
 * here that crawl the open web broadly rather than one vertical, and both are
 * kept because each is individually unreliable: Marginalia answered in 202ms
 * and then not at all within twelve seconds, minutes apart.
 *
 * Marginalia's public API is published under CC-BY-NC-SA 4.0 — attribution,
 * non-commercial. That licence is a constraint on this product, not a detail:
 * see README before charging for traffic that depends on it.
 *
 * The rest are verticals. They are asked in parallel and fused by rank, so a
 * question gets the union of an encyclopaedia, a programming Q&A site, a code
 * host, a news index and the open web rather than whichever one answers first.
 */

export interface Provider {
  name: string;
  /**
   * "web" sources index the open web; "vertical" ones cover a single slice of
   * it. Losing a vertical costs a slice, losing both web indexes costs the web
   * itself, so the two are not worth the same wait.
   */
  tier: "web" | "vertical";
  available(): boolean;
  search(
    query: string,
    limit: number,
    locale: string,
    freshnessHours?: number | null
  ): Promise<RawResult[]>;
}

/**
 * In a parallel fan-out the slowest source sets the response time, so no source
 * is allowed to hold the request open. Marginalia in particular contributes
 * when it answers quickly and is skipped when it does not — waiting longer for
 * it measurably cost seconds and still returned nothing.
 */
const PROVIDER_TIMEOUT = 2500;
const MARGINALIA_TIMEOUT = 2500;

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = PROVIDER_TIMEOUT): Promise<T | null> {
  try {
    const res = await safeFetch(url, { ...init, trusted: true, timeoutMs });
    if (res.status >= 400) return null;
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

/** Strips the highlight markup search APIs wrap matched terms in. */
function plain(text: string | undefined): string {
  return (text ?? "").replace(/<[^>]+>/g, "").replace(/&hellip;/g, "…").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------- general open web */

const marginalia: Provider = {
  name: "marginalia",
  tier: "web",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      results?: { url?: string; title?: string; description?: string; quality?: number }[];
    }>(
      `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}`,
      undefined,
      MARGINALIA_TIMEOUT
    );

    return (data?.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: plain(r.description),
        publishedAt: null,
      }));
  },
};

/**
 * A second general-web index, and the reason there is one: Marginalia's public
 * API is erratic. Measured minutes apart it answered in 202ms and then failed
 * to answer within twelve seconds. Two independent open indexes mean a general
 * question still reaches the open web when either is having a bad minute.
 *
 * mwmbl is a non-profit, open-source crawl with a public API and no key.
 */
const mwmbl: Provider = {
  name: "mwmbl",
  tier: "web",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<
      { url?: string; title?: { value?: string }[]; extract?: { value?: string }[] }[]
    >(`https://api.mwmbl.org/api/v1/search/?s=${encodeURIComponent(query)}`);

    // Titles and extracts arrive as runs of text marked bold where they match.
    const join = (parts: { value?: string }[] | undefined) =>
      (parts ?? []).map((p) => p.value ?? "").join("").trim();

    return (data ?? [])
      .filter((r) => r.url && join(r.title))
      .slice(0, limit)
      .map((r) => ({
        title: join(r.title),
        // This index stores the http form of URLs it crawled long ago, which
        // both cost the result an insecure-link penalty it did not deserve and
        // had us fetch pages in the clear. Sites that only speak http will
        // fail the fetch and fall back to the snippet, which is the better
        // trade in 2026.
        url: (r.url as string).replace(/^http:\/\//i, "https://"),
        snippet: join(r.extract),
        publishedAt: null,
      }));
  },
};

/* ------------------------------------------------------------- verticals */

const wikipedia: Provider = {
  tier: "vertical",
  name: "wikipedia",
  available: () => true,
  async search(query, limit, locale) {
    const primary = locale.split("-")[0] || "en";
    // Both editions are asked at once. Asking them in sequence doubled this
    // provider's worst case, and it was the slowest in the fan-out.
    const langs = primary === "en" ? ["en"] : [primary, "en"];

    const lists = await Promise.all(
      langs.map(async (lang) => {
        const data = await getJson<{
          query?: { search?: { title: string; snippet: string; timestamp?: string }[] };
        }>(
          `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
            query
          )}&format=json&srlimit=${limit}`,
          { headers: { "User-Agent": "Clouda/1.0 (https://clouda.dev)" } }
        );

        return (data?.query?.search ?? []).map<RawResult>((hit) => ({
          title: hit.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
          snippet: plain(hit.snippet),
          publishedAt: hit.timestamp ?? null,
        }));
      })
    );

    // The caller's own language leads; English fills the rest.
    return [...lists.flat()].slice(0, limit);
  },
};

/**
 * Stack Exchange, across the network rather than Stack Overflow alone, so an
 * administration or maths question is not answered from a programming site.
 *
 * Uses /search/excerpts rather than /search/advanced: the advanced endpoint
 * returns no body at all, which is why these results used to arrive with an
 * empty snippet and score poorly for relevance. Excerpts carry no link field,
 * so the URL is built from the question id.
 */
/**
 * Site key to hostname. Not derivable: the older sites kept their own domains
 * while later ones live under stackexchange.com, and assuming the pattern
 * produced links like serverfault.stackexchange.com, which does not exist.
 */
const SE_SITES: { site: string; host: string }[] = [
  { site: "stackoverflow", host: "stackoverflow.com" },
  { site: "superuser", host: "superuser.com" },
  { site: "serverfault", host: "serverfault.com" },
  { site: "askubuntu", host: "askubuntu.com" },
  { site: "unix", host: "unix.stackexchange.com" },
  { site: "dba", host: "dba.stackexchange.com" },
];

const stackexchange: Provider = {
  tier: "vertical",
  name: "stackexchange",
  available: () => true,
  async search(query, limit) {
    const perSite = Math.max(3, Math.ceil(limit / 2));

    const lists = await Promise.all(
      SE_SITES.slice(0, 3).map(async ({ site, host }) => {
        const data = await getJson<{
          items?: {
            question_id?: number;
            title?: string;
            excerpt?: string;
            last_activity_date?: number;
          }[];
        }>(
          `https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance` +
            `&q=${encodeURIComponent(query)}&site=${site}&pagesize=${perSite}`
        );

        return (data?.items ?? [])
          .filter((i) => i.title && i.question_id)
          .map<RawResult>((i) => ({
            title: i.title as string,
            url: `https://${host}/q/${i.question_id}`,
            snippet: plain(i.excerpt),
            publishedAt: i.last_activity_date
              ? new Date(i.last_activity_date * 1000).toISOString()
              : null,
          }));
      })
    );

    // Interleave so one site cannot fill the whole allowance.
    const out: RawResult[] = [];
    for (let rank = 0; out.length < limit; rank++) {
      const before = out.length;
      for (const list of lists) {
        if (out.length >= limit) break;
        if (list[rank]) out.push(list[rank]);
      }
      if (out.length === before) break;
    }
    return out;
  },
};

const github: Provider = {
  tier: "vertical",
  name: "github",
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
  tier: "vertical",
  name: "hackernews",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      hits?: {
        title?: string;
        url?: string;
        objectID?: string;
        created_at?: string;
        story_text?: string;
      }[];
    }>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}`);

    return (data?.hits ?? [])
      .filter((h) => h.title)
      .slice(0, limit)
      .map((h) => ({
        title: h.title as string,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: plain(h.story_text).slice(0, 300),
        publishedAt: h.created_at ?? null,
      }));
  },
};

/**
 * OpenAlex replaces Crossref: same coverage, but it returns an abstract, and a
 * result with no snippet cannot be scored for relevance. Scoped to academic
 * questions — measured against a general query it matched on single stray
 * words and returned papers about unrelated fields.
 */
const openalex: Provider = {
  tier: "vertical",
  name: "openalex",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      results?: {
        title?: string;
        doi?: string;
        id?: string;
        publication_date?: string;
        abstract_inverted_index?: Record<string, number[]>;
      }[];
    }>(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
        `&per-page=${limit}&mailto=hello@clouda.dev`
    );

    return (data?.results ?? [])
      .filter((w) => w.title && (w.doi || w.id))
      .slice(0, limit)
      .map((w) => ({
        title: w.title as string,
        url: (w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//, "")}` : w.id) as string,
        snippet: invertedAbstract(w.abstract_inverted_index).slice(0, 300),
        publishedAt: w.publication_date ?? null,
      }));
  },
};

/** OpenAlex stores abstracts as a word→positions map; rebuild the sentence. */
function invertedAbstract(index: Record<string, number[]> | undefined): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(" ");
}

const npm: Provider = {
  tier: "vertical",
  name: "npm",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      objects?: {
        package?: { name?: string; description?: string; links?: { npm?: string }; date?: string };
      }[];
    }>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`);

    return (data?.objects ?? [])
      .map((o) => o.package)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.name))
      .slice(0, limit)
      .map((p) => ({
        title: p.name as string,
        url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
        snippet: p.description ?? "",
        publishedAt: p.date ?? null,
      }));
  },
};

const googleNews: Provider = {
  tier: "vertical",
  name: "google-news",
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
          snippet: plain($(el).find("description").first().text()),
          publishedAt: $(el).find("pubDate").first().text().trim() || null,
        });
      });
      return out;
    } catch {
      return [];
    }
  },
};

export const OPEN_PROVIDERS: Provider[] = [
  marginalia,
  mwmbl,
  wikipedia,
  stackexchange,
  github,
  hackernews,
  googleNews,
];

export const ALL_PROVIDERS = [...OPEN_PROVIDERS, openalex, npm];

/**
 * Which sources suit a question.
 *
 * Marginalia and Wikipedia are in every set: one covers the open web, the
 * other covers definitions, and between them a question always has somewhere
 * to land. The verticals are added only where they help — OpenAlex answering a
 * news question returns papers that merely share a word with it.
 */
export function openProvidersForIntent(intent: string): Provider[] {
  switch (intent) {
    case "news":
    case "finance":
      return [marginalia, mwmbl, googleNews, wikipedia];
    case "academic":
      return [marginalia, mwmbl, openalex, wikipedia];
    case "technical":
      return [marginalia, mwmbl, stackexchange, github, hackernews, npm];
    case "product":
      return [marginalia, mwmbl, googleNews, hackernews, wikipedia];
    default:
      return OPEN_PROVIDERS;
  }
}

export function providerUnavailable(name: string): CloudaError {
  return new CloudaError("provider_failed", `Sağlayıcı yanıt vermedi: ${name}`, { provider: name });
}
