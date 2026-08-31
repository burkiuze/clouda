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

async function html(url: string): Promise<cheerio.CheerioAPI> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 12_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return cheerio.load(res.body);
}

const probes: Probe[] = [
  {
    name: "stract",
    run: async (q) => {
      const d = await json<{ webpages?: { title?: string }[] }>(
        "https://stract.com/beta/api/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        }
      );
      const hits = d.webpages ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "marginalia",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://api.marginalia.nu/public/search/${encodeURIComponent(q)}`
      );
      const hits = d.results ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "searchmysite",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://searchmysite.net/api/v1/search/?q=${encodeURIComponent(q)}`
      );
      const hits = d.results ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "wiby",
    run: async (q) => {
      const d = await json<{ Title?: string }[]>(
        `https://wiby.me/json/?q=${encodeURIComponent(q)}`
      );
      return { count: d.length, sample: d.slice(0, 3).map((h) => h.Title ?? "?") };
    },
  },
  {
    name: "ddg-instant-answer",
    run: async (q) => {
      const d = await json<{
        AbstractText?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string }[];
      }>(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
      const topics = (d.RelatedTopics ?? []).filter((t) => t.FirstURL);
      return {
        count: topics.length + (d.AbstractText ? 1 : 0),
        sample: topics.slice(0, 3).map((t) => (t.Text ?? "?").slice(0, 80)),
      };
    },
  },
  {
    name: "mdn",
    run: async (q) => {
      const d = await json<{ documents?: { title?: string }[] }>(
        `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(q)}&locale=en-US`
      );
      const hits = d.documents ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "openalex",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=5&mailto=hello@clouda.dev`
      );
      const hits = d.results ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "stackexchange-excerpts",
    run: async (q) => {
      const d = await json<{ items?: { title?: string }[] }>(
        `https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance&q=${encodeURIComponent(
          q
        )}&site=stackoverflow&pagesize=5`
      );
      const hits = d.items ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "reddit",
    run: async (q) => {
      const d = await json<{ data?: { children?: { data?: { title?: string } }[] } }>(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=5`
      );
      const hits = d.data?.children ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.data?.title ?? "?") };
    },
  },
  {
    name: "openlibrary",
    run: async (q) => {
      const d = await json<{ docs?: { title?: string }[] }>(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5`
      );
      const hits = d.docs ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.title ?? "?") };
    },
  },
  {
    name: "npm",
    run: async (q) => {
      const d = await json<{ objects?: { package?: { name?: string } }[] }>(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=5`
      );
      const hits = d.objects ?? [];
      return { count: hits.length, sample: hits.slice(0, 3).map((h) => h.package?.name ?? "?") };
    },
  },
  {
    name: "arxiv",
    run: async (q) => {
      const $ = await html(
        `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=5`
      );
      const titles: string[] = [];
      $("entry > title").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "mojeek",
    run: async (q) => {
      const $ = await html(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`);
      const titles: string[] = [];
      $("a.title, .results-standard li h2 a").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "lobsters",
    run: async (q) => {
      const $ = await html(
        `https://lobste.rs/search?q=${encodeURIComponent(q)}&what=stories&order=relevance`
      );
      const titles: string[] = [];
      $(".story .u-url").each((_, el) => {
        titles.push($(el).text().trim());
      });
      return { count: titles.length, sample: titles.slice(0, 3) };
    },
  },
  {
    name: "ddg-html",
    run: async (q) => {
      const res = await safeFetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        trusted: true,
        timeoutMs: 12_000,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q }).toString(),
      });
      const $ = cheerio.load(res.body);
      const titles: string[] = [];
      $(".result__a").each((_, el) => {
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
