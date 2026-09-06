import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/core/http";
import { consume, LIMITS } from "@/lib/core/limits";
import { requestActor } from "@/lib/core/request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * TEMPORARY. Measures a large batch of candidate sources from this
 * deployment's egress, the same way the search, social and news source sets
 * were chosen. A source that cannot answer from a datacenter IP is worse than
 * absent — it adds a timeout to every query that routes to it.
 */
const TOKEN = process.env.DIAG_TOKEN ?? "probe_c71b9de4a3";

interface Candidate {
  name: string;
  group: string;
  /**
   * A query this source can plausibly answer. Three candidates were recorded
   * as failures in the first pass because they were all asked "postgres
   * index" — there is no city called Postgres and no country called Postgres,
   * so a geocoder and a country database answering nothing were right, and
   * the measurement was wrong. A source is only judged on a fair question.
   */
  probe?: string;
  run: (q: string) => Promise<{ count: number; sample: string[] }>;
}

async function json<T>(url: string, timeoutMs = 6000): Promise<T> {
  const res = await safeFetch(url, { trusted: true, timeoutMs });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

async function text(url: string, timeoutMs = 6000): Promise<string> {
  const res = await safeFetch(url, { trusted: true, timeoutMs });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

const enc = encodeURIComponent;

const candidates: Candidate[] = [
  /* ------------------------------------------------------- reference */
  {
    name: "wikidata",
    group: "reference",
    probe: "postgresql",
    run: async (q) => {
      const d = await json<{ search?: { label?: string; description?: string }[] }>(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q)}&language=en&format=json&limit=5&origin=*`
      );
      const h = d.search ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.label}: ${x.description ?? ""}`) };
    },
  },
  {
    name: "wikipedia-en",
    group: "reference",
    run: async (q) => {
      const d = await json<{ query?: { search?: { title?: string }[] } }>(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&format=json&srlimit=5&origin=*`
      );
      const h = d.query?.search ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "openlibrary",
    group: "reference",
    run: async (q) => {
      const d = await json<{ docs?: { title?: string; author_name?: string[] }[] }>(
        `https://openlibrary.org/search.json?q=${enc(q)}&limit=5&fields=title,author_name`
      );
      const h = d.docs ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.title} — ${(x.author_name ?? [])[0] ?? "?"}`) };
    },
  },
  {
    name: "gutendex",
    group: "reference",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(`https://gutendex.com/books?search=${enc(q)}`);
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },

  /* -------------------------------------------------------- academic */
  {
    name: "arxiv",
    group: "academic",
    run: async (q) => {
      const body = await text(
        `https://export.arxiv.org/api/query?search_query=all:${enc(q)}&max_results=5`,
        15_000
      );
      const titles = [...body.matchAll(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) =>
        m[1].replace(/\s+/g, " ").trim()
      );
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "europepmc",
    group: "academic",
    probe: "crispr gene editing",
    run: async (q) => {
      const d = await json<{ resultList?: { result?: { title?: string; pubYear?: string }[] } }>(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&pageSize=5`
      );
      const h = d.resultList?.result ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.pubYear}: ${x.title}`) };
    },
  },
  {
    name: "crossref",
    group: "academic",
    run: async (q) => {
      const d = await json<{ message?: { items?: { title?: string[]; DOI?: string }[] } }>(
        `https://api.crossref.org/works?query=${enc(q)}&rows=5&select=title,DOI`
      );
      const h = d.message?.items ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${(x.title ?? [])[0]} (${x.DOI})`) };
    },
  },
  {
    name: "semanticscholar",
    group: "academic",
    run: async (q) => {
      const d = await json<{ data?: { title?: string; year?: number }[] }>(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q)}&limit=5&fields=title,year`
      );
      const h = d.data ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.year}: ${x.title}`) };
    },
  },
  {
    name: "doaj",
    group: "academic",
    probe: "machine learning",
    run: async (q) => {
      const d = await json<{ results?: { bibjson?: { title?: string } }[] }>(
        `https://doaj.org/api/search/articles/${enc(q)}?pageSize=5`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.bibjson?.title ?? "?") };
    },
  },

  /* ------------------------------------------------ code and packages */
  {
    name: "crates-io",
    group: "packages",
    run: async (q) => {
      const d = await json<{ crates?: { name?: string; description?: string }[] }>(
        `https://crates.io/api/v1/crates?q=${enc(q)}&per_page=5`
      );
      const h = d.crates ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.name}: ${x.description ?? ""}`) };
    },
  },
  {
    name: "packagist",
    group: "packages",
    run: async (q) => {
      const d = await json<{ results?: { name?: string; description?: string }[] }>(
        `https://packagist.org/search.json?q=${enc(q)}&per_page=5`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.name}: ${x.description ?? ""}`) };
    },
  },
  {
    name: "rubygems",
    group: "packages",
    run: async (q) => {
      const d = await json<{ name?: string; info?: string }[]>(
        `https://rubygems.org/api/v1/search.json?query=${enc(q)}`
      );
      const h = Array.isArray(d) ? d : [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.name}: ${x.info ?? ""}`) };
    },
  },
  {
    name: "nuget",
    group: "packages",
    run: async (q) => {
      const d = await json<{ data?: { id?: string; description?: string }[] }>(
        `https://azuresearch-usnc.nuget.org/query?q=${enc(q)}&take=5`
      );
      const h = d.data ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.id}: ${x.description ?? ""}`) };
    },
  },
  {
    name: "maven",
    group: "packages",
    run: async (q) => {
      const d = await json<{ response?: { docs?: { a?: string; g?: string }[] } }>(
        `https://search.maven.org/solrsearch/select?q=${enc(q)}&rows=5&wt=json`,
        15_000
      );
      const h = d.response?.docs ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.g}:${x.a}`) };
    },
  },
  {
    name: "pypi-warehouse",
    group: "packages",
    run: async (q) => {
      const body = await text(`https://pypi.org/search/?q=${enc(q)}`);
      const names = [...body.matchAll(/package-snippet__name">([^<]+)</g)].map((m) => m[1].trim());
      return { count: names.length, sample: names.slice(0, 3) };
    },
  },

  /* -------------------------------------------------------- live data */
  {
    name: "open-meteo-geocode",
    group: "livedata",
    probe: "istanbul",
    run: async (q) => {
      const d = await json<{ results?: { name?: string; country?: string; latitude?: number }[] }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${enc(q)}&count=3&language=tr`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.name}, ${x.country} @${x.latitude}`) };
    },
  },
  {
    name: "open-meteo-forecast",
    group: "livedata",
    run: async () => {
      const d = await json<{ current?: Record<string, unknown> }>(
        "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.98&current=temperature_2m,wind_speed_10m"
      );
      return { count: d.current ? 1 : 0, sample: [JSON.stringify(d.current ?? {}).slice(0, 90)] };
    },
  },
  {
    name: "frankfurter-fx",
    group: "livedata",
    run: async () => {
      const d = await json<{ rates?: Record<string, number>; date?: string }>(
        "https://api.frankfurter.app/latest?from=EUR&to=USD,TRY,GBP"
      );
      const n = Object.keys(d.rates ?? {}).length;
      return { count: n, sample: [`${d.date}: ${JSON.stringify(d.rates ?? {})}`] };
    },
  },
  {
    name: "coingecko",
    group: "livedata",
    run: async () => {
      const d = await json<Record<string, Record<string, number>>>(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,try"
      );
      return { count: Object.keys(d).length, sample: [JSON.stringify(d).slice(0, 90)] };
    },
  },
  {
    name: "yahoo-quote",
    group: "livedata",
    run: async () => {
      const d = await json<{ chart?: { result?: { meta?: Record<string, unknown> }[] } }>(
        "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d"
      );
      const meta = d.chart?.result?.[0]?.meta;
      return { count: meta ? 1 : 0, sample: [JSON.stringify(meta ?? {}).slice(0, 110)] };
    },
  },
  {
    name: "sec-edgar-fts",
    group: "livedata",
    run: async (q) => {
      const d = await json<{ hits?: { hits?: { _source?: { display_names?: string[] } }[] } }>(
        `https://efts.sec.gov/LATEST/search-index?q=${enc(q)}&forms=10-K`
      );
      const h = d.hits?.hits ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => (x._source?.display_names ?? [])[0] ?? "?") };
    },
  },
  {
    name: "usgs-quakes",
    group: "livedata",
    run: async () => {
      const d = await json<{ features?: { properties?: { title?: string } }[] }>(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
      );
      const h = d.features ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.properties?.title ?? "?") };
    },
  },
  {
    name: "worldbank",
    group: "livedata",
    run: async () => {
      const d = await json<unknown[]>(
        "https://api.worldbank.org/v2/country/TR/indicator/NY.GDP.MKTP.CD?format=json&per_page=3"
      );
      const rows = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as { date?: string; value?: number }[]) : [];
      return { count: rows.length, sample: rows.slice(0, 3).map((r) => `${r.date}: ${r.value}`) };
    },
  },
  {
    name: "restcountries",
    group: "livedata",
    probe: "turkey",
    run: async (q) => {
      const d = await json<{ name?: { common?: string }; population?: number }[]>(
        `https://restcountries.com/v3.1/name/${enc(q.split(" ")[0])}?fields=name,population`
      );
      const h = Array.isArray(d) ? d : [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.name?.common}: ${x.population}`) };
    },
  },

  /* ----------------------------------------------------------- archive */
  {
    name: "wayback-availability",
    group: "archive",
    run: async () => {
      const d = await json<{ archived_snapshots?: { closest?: { timestamp?: string; url?: string } } }>(
        "https://archive.org/wayback/available?url=example.com"
      );
      const c = d.archived_snapshots?.closest;
      return { count: c ? 1 : 0, sample: [`${c?.timestamp} ${c?.url}`] };
    },
  },
  {
    name: "archive-org-search",
    group: "archive",
    run: async (q) => {
      const d = await json<{ response?: { docs?: { title?: string; identifier?: string }[] } }>(
        `https://archive.org/advancedsearch.php?q=${enc(q)}&fl%5B%5D=title&fl%5B%5D=identifier&rows=5&output=json`
      );
      const h = d.response?.docs ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? x.identifier ?? "?") };
    },
  },

  /* -------------------------------------------------------------- docs */
  {
    name: "mdn",
    group: "docs",
    probe: "fetch api",
    run: async (q) => {
      const d = await json<{ documents?: { title?: string; mdn_url?: string }[] }>(
        `https://developer.mozilla.org/api/v1/search?q=${enc(q)}&locale=en-US`
      );
      const h = d.documents ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.title} ${x.mdn_url}`) };
    },
  },
  {
    name: "readthedocs",
    group: "docs",
    run: async (q) => {
      const d = await json<{ results?: { title?: string; domain?: string }[] }>(
        `https://readthedocs.org/api/v3/search/?q=${enc(q)}`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.domain} ${x.title}`) };
    },
  },
];

export async function GET(req: NextRequest) {
  if (!TOKEN || req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // One call reaches out to nearly thirty third parties. The token is in a
  // public repository until this route is deleted, so the cap is what actually
  // stops it being used as an amplifier.
  const verdict = await consume(LIMITS.diagnostics, requestActor(req));
  if (!verdict.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const query = req.nextUrl.searchParams.get("q") ?? "postgres";

  const results = await Promise.all(
    candidates.map(async (c) => {
      const started = Date.now();
      const asked = c.probe ?? query;
      try {
        const { count, sample } = await c.run(asked);
        return {
          name: c.name,
          group: c.group,
          asked,
          ok: count > 0,
          count,
          ms: Date.now() - started,
          sample,
        };
      } catch (err) {
        return {
          name: c.name,
          group: c.group,
          asked,
          ok: false,
          count: 0,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message.slice(0, 90) : "unknown",
        };
      }
    })
  );

  results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms);
  return NextResponse.json({
    query,
    ok: results.filter((r) => r.ok).length,
    total: results.length,
    results,
  });
}
