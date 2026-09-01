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
    name: "searx-be",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://searx.be/search?q=${encodeURIComponent(q)}&format=json`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "searxng-site",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://searxng.site/search?q=${encodeURIComponent(q)}&format=json`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "opnxng",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://opnxng.com/search?q=${encodeURIComponent(q)}&format=json`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "yep",
    run: async (q) => {
      const d = await json<unknown[]>(
        `https://api.yep.com/fs/2/search?client=web&gl=US&limit=10&no_correct=false&q=${encodeURIComponent(q)}&safeSearch=strict&type=web`
      );
      const block = Array.isArray(d) ? (d[1] as { results?: { title?: string }[] }) : undefined;
      const h = block?.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "teclis",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://teclis.com/search?q=${encodeURIComponent(q)}&format=json`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "wikidata",
    run: async (q) => {
      const d = await json<{ search?: { label?: string; description?: string }[] }>(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=tr&uselang=tr&format=json&limit=5`
      );
      const h = d.search ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => `${x.label} — ${x.description ?? ""}`) };
    },
  },
  {
    name: "semanticscholar",
    run: async (q) => {
      const d = await json<{ data?: { title?: string }[] }>(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=5&fields=title,abstract,url,year`
      );
      const h = d.data ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "devto",
    run: async (q) => {
      const d = await json<{ title?: string }[]>(
        `https://dev.to/api/articles?per_page=5&tag=&search=${encodeURIComponent(q)}`
      );
      return { count: d.length, sample: d.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "crates",
    run: async (q) => {
      const d = await json<{ crates?: { name?: string }[] }>(
        `https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=5`
      );
      const h = d.crates ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.name ?? "?") };
    },
  },
  {
    name: "googlebooks",
    run: async (q) => {
      const d = await json<{ items?: { volumeInfo?: { title?: string } }[] }>(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`
      );
      const h = d.items ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.volumeInfo?.title ?? "?") };
    },
  },
  {
    name: "archive-org",
    run: async (q) => {
      const d = await json<{ response?: { docs?: { title?: string }[] } }>(
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl%5B%5D=title&rows=5&output=json`
      );
      const h = d.response?.docs ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
    },
  },
  {
    name: "huggingface",
    run: async (q) => {
      const d = await json<{ id?: string }[]>(
        `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=5`
      );
      return { count: d.length, sample: d.slice(0, 3).map((x) => x.id ?? "?") };
    },
  },
  {
    name: "marginalia",
    run: async (q) => {
      const d = await json<{ results?: { title?: string }[] }>(
        `https://api.marginalia.nu/public/search/${encodeURIComponent(q)}`
      );
      const h = d.results ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => x.title ?? "?") };
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
