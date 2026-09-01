import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/core/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * TEMPORARY. Probes candidate discovery sources from the deployment's own
 * egress so the provider set is chosen from measurements rather than
 * assumptions — the last source added on reputation alone (Bing's RSS view)
 * returned results unrelated to the query. Delete once the set is settled.
 */

const TOKEN = "probe_9f4c1a7e2b";

interface Probe {
  name: string;
  run: (q: string) => Promise<{ count: number; sample: string[] }>;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await safeFetch(url, { ...init, trusted: true, timeoutMs: 12_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function html(url: string): Promise<cheerio.CheerioAPI> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 12_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return cheerio.load(res.body);
}

const probes: Probe[] = [
  {
    name: "mwmbl",
    run: async (q) => {
      const d = await json<{ title?: { value?: string }[] }[]>(
        `https://api.mwmbl.org/api/v1/search/?s=${encodeURIComponent(q)}`
      );
      return {
        count: d.length,
        sample: d.slice(0, 3).map((x) => (x.title ?? []).map((t) => t.value).join("")),
      };
    },
  },
  {
    name: "ddg-lite",
    run: async (q) => {
      const res = await safeFetch("https://lite.duckduckgo.com/lite/", {
        method: "POST",
        trusted: true,
        timeoutMs: 12_000,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q }).toString(),
      });
      const $ = cheerio.load(res.body);
      const titles: string[] = [];
      $("a.result-link").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "ecosia",
    run: async (q) => {
      const $ = await html(`https://www.ecosia.org/search?q=${encodeURIComponent(q)}`);
      const titles: string[] = [];
      $("a.result__link, .result__title a, [data-test-id='result-link']").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "startpage",
    run: async (q) => {
      const $ = await html(`https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`);
      const titles: string[] = [];
      $(".w-gl__result-title, .result-title").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "qwant",
    run: async (q) => {
      const d = await json<{ data?: { result?: { items?: unknown[] } } }>(
        `https://api.qwant.com/v3/search/web?q=${encodeURIComponent(q)}&count=10&locale=en_US&offset=0&device=desktop`
      );
      const items = d.data?.result?.items ?? [];
      return { count: items.length, sample: [] };
    },
  },
  {
    name: "marginalia-retry",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://api.marginalia.nu/public/search/${encodeURIComponent(q)}`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "pypi",
    run: async (q) => {
      const $ = await html(`https://pypi.org/search/?q=${encodeURIComponent(q)}`);
      const titles: string[] = [];
      $(".package-snippet__name").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "vektör veritabanı nedir";

  // Dumps one raw item so field names are read off the wire, not guessed.
  const raw = req.nextUrl.searchParams.get("raw");
  if (raw) {
    const urls: Record<string, string> = {
      marginalia: `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}`,
      // Two candidate ways to turn a Turkish query into an English one, since
      // the general-web index only covers English.
      mymemory: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=tr|en`,
      wikidata: `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        query
      )}&language=tr&uselang=tr&format=json&limit=3`,
      stackexchange: `https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=2`,
      npm: `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=2`,
    };
    if (!urls[raw]) return NextResponse.json({ error: "unknown_raw" }, { status: 400 });
    const res = await safeFetch(urls[raw], { trusted: true, timeoutMs: 12_000 });
    return new NextResponse(res.body.slice(0, 4000), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all(
    probes.map(async (probe) => {
      const started = Date.now();
      try {
        const { count, sample } = await probe.run(query);
        return { name: probe.name, ok: count > 0, count, ms: Date.now() - started, sample };
      } catch (err) {
        return {
          name: probe.name,
          ok: false,
          count: 0,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        };
      }
    })
  );

  results.sort((a, b) => Number(b.ok) - Number(a.ok) || b.count - a.count);
  return NextResponse.json({ query, results });
}
