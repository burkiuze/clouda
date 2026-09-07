import * as cheerio from "cheerio";
import { AsyncLocalStorage } from "node:async_hooks";
import { safeFetch } from "@/lib/core/http";
import { CloudaError } from "@/lib/core/errors";
import { RawResult } from "@/lib/search/types";
import { asRawResults, matchNews, newsCorpus } from "@/lib/search/newsroom";
import { isUrlAllowed } from "@/lib/core/security";
import { contactEmail, userAgent } from "@/lib/config";

/**
 * Discovery providers: open APIs plus an optional operator-configured backend.
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

const attemptScope = new AsyncLocalStorage<{ succeeded: number; failed: number }>();

/** Composite providers may lose one endpoint and keep useful results. Only a
 * wholly failed attempt is an outage; a valid empty response is not one.
 */
export async function searchProvider(
  provider: Provider, query: string, limit: number, locale: string, freshnessHours?: number | null
): Promise<RawResult[]> {
  const attempt = { succeeded: 0, failed: 0 };
  const results = await attemptScope.run(attempt, () => provider.search(query, limit, locale, freshnessHours));
  if (!results.length && attempt.failed > 0 && attempt.succeeded === 0) throw providerUnavailable(provider.name);
  return results;
}

function recordAttempt(success: boolean): void {
  const attempt = attemptScope.getStore();
  if (attempt) attempt[success ? "succeeded" : "failed"]++;
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = PROVIDER_TIMEOUT): Promise<T | null> {
  try {
    const res = await safeFetch(url, { ...init, trusted: true, timeoutMs });
    if (res.status < 200 || res.status >= 300) throw new Error("upstream_status");
    const value = JSON.parse(res.body) as T;
    recordAttempt(true);
    return value;
  } catch {
    recordAttempt(false);
    return null;
  }
}

/** Same contract as getJson, for sources that answer in XML rather than JSON. */
async function getText(url: string, init?: RequestInit, timeoutMs = PROVIDER_TIMEOUT): Promise<string | null> {
  try {
    const res = await safeFetch(url, { ...init, trusted: true, timeoutMs });
    if (res.status < 200 || res.status >= 300) throw new Error("upstream_status");
    recordAttempt(true);
    return res.body;
  } catch {
    recordAttempt(false);
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
      `https://api2.marginalia-search.com/search?query=${encodeURIComponent(query)}` +
        `&count=${Math.min(limit, 100)}&timeout=250&dc=3&nsfw=1`,
      { headers: { "API-Key": process.env.MARGINALIA_API_KEY || "public" } },
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
          { headers: { "User-Agent": userAgent() } }
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
        `&per-page=${limit}&mailto=${encodeURIComponent(contactEmail())}`
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


const googleNews: Provider = {
  tier: "vertical",
  name: "google-news",
  available: () => true,
  async search(query, limit, locale) {
    const [lang, region = lang.toUpperCase()] = locale.split("-");
    try {
      const body = await getText(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${region}&ceid=${region}:${lang}`,
      );
      if (body === null) return [];
      const $ = cheerio.load(body, { xml: true });
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

/* -------------------------------------------------------------- newsroom */

/**
 * Publisher feeds, pulled in the background and matched locally.
 *
 * This is the only source here that does no network work at request time. The
 * corpus is refreshed out of band, so a news query is answered from memory —
 * and unlike Google News, every item carries a real article URL that the
 * extraction stage can actually read.
 */
const newsroom: Provider = {
  name: "newsroom",
  tier: "vertical",
  available: () => true,
  async search(query, limit, _locale, freshnessHours) {
    const corpus = await newsCorpus();
    if (corpus.length === 0) return [];
    return asRawResults(matchNews(corpus, query, limit, freshnessHours));
  },
};

/* ------------------------------------------------- structured reference */

/**
 * Wikidata: the entity, not an article about the entity.
 *
 * Measured at 327ms with exactly the answer a definitional question wants —
 * "PostgreSQL: free and open-source relational database management system".
 * Wikipedia gives the prose; this gives the one-line identity, which is often
 * the whole answer and is never buried in it.
 */
const wikidata: Provider = {
  tier: "vertical",
  name: "wikidata",
  available: () => true,
  async search(query, limit, locale) {
    const lang = locale.split("-")[0] || "en";
    const data = await getJson<{
      search?: { id?: string; label?: string; description?: string; concepturi?: string }[];
    }>(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json` +
        `&search=${encodeURIComponent(query)}&language=${lang}&uselang=${lang}&limit=${Math.min(limit, 20)}`,
      { headers: { "User-Agent": userAgent() } }
    );

    return (data?.search ?? [])
      .filter((hit) => hit.label && (hit.concepturi || hit.id))
      .map((hit) => ({
        title: hit.label as string,
        url: hit.concepturi ?? `https://www.wikidata.org/wiki/${hit.id}`,
        snippet: hit.description ?? "",
        publishedAt: null,
      }));
  },
};

/* ------------------------------------------------------------------ docs */

/**
 * MDN, for web-platform questions. Measured at 307ms, and it answers the kind
 * of question — "how does fetch handle redirects" — that a general index
 * answers with a blog post copied from MDN three years ago.
 */
const mdn: Provider = {
  tier: "vertical",
  name: "mdn",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      documents?: { title?: string; mdn_url?: string; summary?: string }[];
    }>(
      `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`
    );

    return (data?.documents ?? [])
      .filter((doc) => doc.title && doc.mdn_url)
      .slice(0, limit)
      .map((doc) => ({
        title: doc.title as string,
        url: `https://developer.mozilla.org${doc.mdn_url}`,
        snippet: doc.summary ?? "",
        publishedAt: null,
      }));
  },
};

/* -------------------------------------------------------------- packages */

/**
 * Five package registries behind one source.
 *
 * They are grouped rather than listed separately on purpose. Each registry is
 * a small, fast, keyless API, but the fan-out is bounded by its slowest member
 * and every extra entry in it is another deadline the whole query can wait on.
 * Asked together and merged here, five registries cost the fan-out one slot.
 *
 * Which ones get asked depends on the query: "rust http client" has no
 * business waiting on RubyGems. When the query names no ecosystem, all five
 * are asked, because guessing wrong is worse than asking.
 */
interface Registry {
  name: string;
  /** Words that make this registry the obvious one to ask. */
  hints: RegExp;
  search(query: string, limit: number): Promise<RawResult[]>;
}

const REGISTRIES: Registry[] = [
  {
    name: "npm",
    hints: /\b(npm|node|nodejs|javascript|js|typescript|ts|react|vue|angular|svelte|deno|bun)\b/i,
    async search(query, limit) {
      const data = await getJson<{
        objects?: {
          package?: { name?: string; description?: string; links?: { npm?: string }; date?: string };
        }[];
      }>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`);

      return (data?.objects ?? [])
        .map((o) => o.package)
        .filter((pkg): pkg is NonNullable<typeof pkg> => Boolean(pkg?.name))
        .map((pkg) => ({
          title: `npm: ${pkg.name}`,
          url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
          snippet: pkg.description ?? "",
          publishedAt: pkg.date ?? null,
        }));
    },
  },
  {
    name: "crates",
    hints: /\b(rust|cargo|crate|crates|tokio|serde)\b/i,
    async search(query, limit) {
      const data = await getJson<{
        crates?: { name?: string; description?: string; updated_at?: string }[];
      }>(
        `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${limit}`,
        { headers: { "User-Agent": userAgent() } }
      );

      return (data?.crates ?? [])
        .filter((crate) => crate.name)
        .map((crate) => ({
          title: `crates.io: ${crate.name}`,
          url: `https://crates.io/crates/${crate.name}`,
          snippet: crate.description ?? "",
          publishedAt: crate.updated_at ?? null,
        }));
    },
  },
  {
    name: "packagist",
    hints: /\b(php|composer|laravel|symfony|packagist)\b/i,
    async search(query, limit) {
      const data = await getJson<{
        results?: { name?: string; description?: string; url?: string }[];
      }>(`https://packagist.org/search.json?q=${encodeURIComponent(query)}&per_page=${limit}`);

      return (data?.results ?? [])
        .filter((pkg) => pkg.name)
        .map((pkg) => ({
          title: `packagist: ${pkg.name}`,
          url: pkg.url ?? `https://packagist.org/packages/${pkg.name}`,
          snippet: pkg.description ?? "",
          publishedAt: null,
        }));
    },
  },
  {
    name: "nuget",
    hints: /\b(c#|csharp|dotnet|\.net|nuget|asp\.net|blazor)\b/i,
    async search(query, limit) {
      const data = await getJson<{
        data?: { id?: string; description?: string; projectUrl?: string; version?: string }[];
      }>(
        `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${limit}`
      );

      return (data?.data ?? [])
        .filter((pkg) => pkg.id)
        .map((pkg) => ({
          title: `NuGet: ${pkg.id}`,
          url: `https://www.nuget.org/packages/${pkg.id}`,
          snippet: pkg.description ?? "",
          publishedAt: null,
        }));
    },
  },
  {
    name: "rubygems",
    hints: /\b(ruby|rails|gem|gems|rubygems|sinatra)\b/i,
    async search(query, limit) {
      const data = await getJson<
        { name?: string; info?: string; project_uri?: string; version_created_at?: string }[]
      >(`https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(query)}`);

      return (Array.isArray(data) ? data : [])
        .filter((gem) => gem.name)
        .slice(0, limit)
        .map((gem) => ({
          title: `gem: ${gem.name}`,
          url: gem.project_uri ?? `https://rubygems.org/gems/${gem.name}`,
          snippet: gem.info ?? "",
          publishedAt: gem.version_created_at ?? null,
        }));
    },
  },
];

const packages: Provider = {
  tier: "vertical",
  name: "packages",
  available: () => true,
  async search(query, limit) {
    const named = REGISTRIES.filter((registry) => registry.hints.test(query));
    const asked = named.length > 0 ? named : REGISTRIES;

    // One registry failing must not lose the others: they are independent
    // answers to the same question, not steps in a sequence.
    const lists = await Promise.all(
      asked.map((registry) =>
        registry.search(query, Math.max(3, Math.ceil(limit / asked.length))).catch(() => [])
      )
    );

    // Interleaved rather than concatenated, so the merged list is not simply
    // the first registry's results followed by everyone else's.
    const merged: RawResult[] = [];
    for (let rank = 0; merged.length < limit; rank++) {
      const before = merged.length;
      for (const list of lists) {
        if (list[rank]) merged.push(list[rank]);
        if (merged.length >= limit) break;
      }
      if (merged.length === before) break;
    }
    return merged;
  },
};

/* -------------------------------------------------------------- scholar */

/**
 * Three academic indexes behind one source, grouped for the same reason as the
 * registries. OpenAlex stays separate because it is broad enough to stand on
 * its own; these three each cover a slice OpenAlex covers thinly — arXiv the
 * preprints, Europe PMC the biomedical literature, DOAJ the open-access
 * journals.
 *
 * arXiv is simply erratic, and measured to be: 6s timeout, then 87ms, then
 * 11.2s, on the same query from the same place. It is kept for the same reason
 * Marginalia is — when it answers it answers well, and the architecture is
 * built so that a source having a bad minute costs coverage rather than time.
 * Its slow runs are cut off by the provider timeout and its slot is filled by
 * the two indexes beside it.
 */
const scholar: Provider = {
  tier: "vertical",
  name: "scholar",
  available: () => true,
  async search(query, limit) {
    const per = Math.max(3, Math.ceil(limit / 3));

    const arxiv = async (): Promise<RawResult[]> => {
      const body = await getText(
        `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${per}`
      );
      if (!body) return [];

      return [...body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
        .map((match) => {
          const entry = match[1];
          const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
          const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
          const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim();
          const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
          if (!title || !id) return null;
          const result: RawResult = {
            title: `arXiv: ${title}`,
            url: id,
            snippet: (summary ?? "").slice(0, 300),
            publishedAt: published ?? null,
          };
          return result;
        })
        .filter((r): r is RawResult => r !== null);
    };

    const europepmc = async (): Promise<RawResult[]> => {
      const data = await getJson<{
        resultList?: {
          result?: { title?: string; doi?: string; id?: string; source?: string; firstPublicationDate?: string; abstractText?: string }[];
        };
      }>(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}` +
          `&format=json&pageSize=${per}`
      );

      return (data?.resultList?.result ?? [])
        .filter((work) => work.title)
        .map((work) => ({
          title: work.title as string,
          url: work.doi
            ? `https://doi.org/${work.doi}`
            : `https://europepmc.org/article/${work.source ?? "MED"}/${work.id ?? ""}`,
          snippet: (work.abstractText ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
          publishedAt: work.firstPublicationDate ?? null,
        }));
    };

    const doaj = async (): Promise<RawResult[]> => {
      const data = await getJson<{
        results?: {
          bibjson?: {
            title?: string;
            abstract?: string;
            year?: string;
            link?: { url?: string; type?: string }[];
            identifier?: { id?: string; type?: string }[];
          };
        }[];
      }>(`https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${per}`);

      return (data?.results ?? [])
        .map((entry) => entry.bibjson)
        .filter((work): work is NonNullable<typeof work> => Boolean(work?.title))
        .map((work) => {
          const doi = work.identifier?.find((i) => i.type === "doi")?.id;
          const link = work.link?.find((l) => l.type === "fulltext")?.url ?? work.link?.[0]?.url;
          return {
            title: work.title as string,
            url: doi ? `https://doi.org/${doi}` : (link ?? ""),
            snippet: (work.abstract ?? "").slice(0, 300),
            publishedAt: work.year ? `${work.year}-01-01` : null,
          };
        })
        .filter((r) => r.url);
    };

    const lists = await Promise.all([
      arxiv().catch(() => []),
      europepmc().catch(() => []),
      doaj().catch(() => []),
    ]);

    const merged: RawResult[] = [];
    for (let rank = 0; merged.length < limit; rank++) {
      const before = merged.length;
      for (const list of lists) {
        if (list[rank]) merged.push(list[rank]);
        if (merged.length >= limit) break;
      }
      if (merged.length === before) break;
    }
    return merged;
  },
};

/* --------------------------------------------------------------- filings */

/**
 * SEC full-text search over company filings. A question about what a listed
 * company actually said about something is answered by the filing, not by
 * coverage of the filing.
 */
const secFilings: Provider = {
  tier: "vertical",
  name: "sec-filings",
  available: () => true,
  async search(query, limit) {
    const data = await getJson<{
      hits?: {
        hits?: {
          _id?: string;
          _source?: { display_names?: string[]; file_type?: string; file_date?: string; adsh?: string; ciks?: string[] };
        }[];
      };
    }>(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&hits=${limit}`,
      { headers: { "User-Agent": userAgent() } }
    );

    return (data?.hits?.hits ?? [])
      .slice(0, limit)
      .map((hit) => {
        const source = hit._source;
        const cik = source?.ciks?.[0]?.replace(/^0+/, "");
        const [accession, document] = (hit._id ?? "").split(":");
        const company = source?.display_names?.[0] ?? "SEC filing";

        return {
          title: `${company} — ${source?.file_type ?? "filing"}`,
          url:
            cik && accession
              ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${document ?? ""}`
              : "https://www.sec.gov/edgar/search/",
          snippet: `${source?.file_type ?? ""} ${source?.file_date ?? ""}`.trim(),
          publishedAt: source?.file_date ?? null,
        };
      })
      .filter((r) => r.url);
  },
};

export const OPEN_PROVIDERS: Provider[] = [
  newsroom,
  marginalia,
  mwmbl,
  wikipedia,
  wikidata,
  stackexchange,
  github,
  hackernews,
  googleNews,
];

/** Use an operator-configured endpoint, never a rotating public instance list.
 * JSON must be enabled by the operator. User-supplied queries cannot change
 * the endpoint; URL safety and redirect restrictions still apply.
 */
const searxng: Provider = {
  name: "searxng", tier: "web",
  available: () => Boolean(process.env.SEARXNG_BASE_URL && isUrlAllowed(process.env.SEARXNG_BASE_URL)),
  async search(query, limit, locale, freshnessHours) {
    if (!this.available()) return [];
    const url = new URL(process.env.SEARXNG_BASE_URL!.replace(/\/?$/, "/") + "search");
    url.search = new URLSearchParams({ q: query, format: "json", language: locale, safesearch: "2" }).toString();
    if (freshnessHours != null && freshnessHours <= 8760) url.searchParams.set("time_range",
      freshnessHours <= 24 ? "day" : freshnessHours <= 744 ? "month" : "year");
    const data = await getJson<{ results?: { title?: string; url?: string; content?: string; publishedDate?: string }[] }>(url.toString());
    return (data?.results ?? []).filter((r) => r.url && r.title).slice(0, limit).map((r) => ({
      title: plain(r.title), url: r.url!, snippet: plain(r.content), publishedAt: r.publishedDate ?? null,
    }));
  },
};

export const ALL_PROVIDERS = [
  searxng,
  ...OPEN_PROVIDERS,
  openalex,
  scholar,
  packages,
  mdn,
  secFilings,
];

export { newsroom };

/**
 * Which sources suit a question.
 *
 * Marginalia and Wikipedia are in every set: one covers the open web, the
 * other covers definitions, and between them a question always has somewhere
 * to land. The verticals are added only where they help — OpenAlex answering a
 * news question returns papers that merely share a word with it.
 */
function providersForIntent(intent: string): Provider[] {
  switch (intent) {
    case "news":
      return [newsroom, marginalia, mwmbl, googleNews, wikipedia, wikidata];
    case "finance":
      // Filings say what a company actually stated; coverage says what someone
      // wrote about what it stated. Both are useful, and they are not the same
      // claim, so both are asked.
      return [newsroom, marginalia, mwmbl, googleNews, secFilings, wikidata];
    case "academic":
      return [marginalia, mwmbl, openalex, scholar, wikipedia, wikidata];
    case "technical":
      return [marginalia, mwmbl, stackexchange, github, hackernews, packages, mdn];
    case "product":
      return [newsroom, marginalia, mwmbl, googleNews, hackernews, packages, wikipedia];
    default:
      return [marginalia, mwmbl, wikipedia, wikidata, newsroom, stackexchange, github, hackernews, googleNews];
  }
}

export function openProvidersForIntent(intent: string): Provider[] {
  const configured = searxng.available() ? [searxng] : [];
  return [...configured, ...providersForIntent(intent)];
}

export function providerUnavailable(name: string): CloudaError {
  return new CloudaError("provider_failed", `Sağlayıcı yanıt vermedi: ${name}`, { provider: name });
}
