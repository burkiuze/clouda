import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/core/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** TEMPORARY. Measures candidate news sources from this deployment's egress. */
const TOKEN = "probe_9f4c1a7e2b";

interface Probe {
  name: string;
  run: (q: string) => Promise<{ count: number; sample: string[] }>;
}

async function json<T>(url: string): Promise<T> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 10_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

async function text(url: string): Promise<string> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 10_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

function rssTitles(body: string): string[] {
  return [...body.matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1].trim());
}

const probes: Probe[] = [
  {
    name: "gdelt",
    run: async (q) => {
      const d = await json<{ articles?: { title?: string; domain?: string; seendate?: string }[] }>(
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=10&format=json&sort=datedesc`
      );
      const h = d.articles ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((a) => `${a.domain}: ${a.title}`) };
    },
  },
  {
    name: "gdelt-turkish",
    run: async (q) => {
      const d = await json<{ articles?: { title?: string; domain?: string }[] }>(
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}%20sourcelang:turkish&mode=artlist&maxrecords=10&format=json&sort=datedesc`
      );
      const h = d.articles ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((a) => `${a.domain}: ${a.title}`) };
    },
  },
  {
    name: "yahoo-news-rss",
    run: async (q) => {
      const t = rssTitles(await text(`https://news.search.yahoo.com/rss?p=${encodeURIComponent(q)}`));
      return { count: Math.max(0, t.length - 1), sample: t.slice(1, 4) };
    },
  },
  {
    name: "bing-news-rss",
    run: async (q) => {
      const t = rssTitles(await text(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`));
      return { count: Math.max(0, t.length - 1), sample: t.slice(1, 4) };
    },
  },
  {
    name: "aa-rss",
    run: async () => {
      const t = rssTitles(await text("https://www.aa.com.tr/tr/rss/default?cat=guncel"));
      return { count: Math.max(0, t.length - 1), sample: t.slice(1, 4) };
    },
  },
  {
    name: "bbc-turkce-rss",
    run: async () => {
      const t = rssTitles(await text("https://feeds.bbci.co.uk/turkce/rss.xml"));
      return { count: Math.max(0, t.length - 1), sample: t.slice(1, 4) };
    },
  },
  {
    name: "reuters-rss",
    run: async () => {
      const t = rssTitles(await text("https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best"));
      return { count: Math.max(0, t.length - 1), sample: t.slice(1, 4) };
    },
  },
  {
    name: "hn-frontpage",
    run: async (q) => {
      const d = await json<{ hits?: { title?: string }[] }>(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=5`
      );
      const h = d.hits ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const query = req.nextUrl.searchParams.get("q") ?? "türkiye ekonomi";

  const results = await Promise.all(
    probes.map(async (p) => {
      const started = Date.now();
      try {
        const { count, sample } = await p.run(query);
        return { name: p.name, ok: count > 0, count, ms: Date.now() - started, sample };
      } catch (err) {
        return {
          name: p.name,
          ok: false,
          count: 0,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message.slice(0, 110) : "unknown",
        };
      }
    })
  );
  results.sort((a, b) => Number(b.ok) - Number(a.ok) || b.count - a.count);
  return NextResponse.json({ query, results });
}
