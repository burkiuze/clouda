import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/core/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * TEMPORARY. Measures which social platforms answer from this deployment's own
 * egress before any of them is wired in. Social APIs are the most aggressively
 * gated surface on the web — most demand a key, a session cookie, or a
 * residential address — so the set is chosen from what actually replies.
 */

const TOKEN = "probe_9f4c1a7e2b";

interface Probe {
  name: string;
  run: (q: string) => Promise<{ count: number; sample: string[] }>;
}

async function json<T>(url: string): Promise<T> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 12_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

async function text(url: string): Promise<string> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: 12_000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

const probes: Probe[] = [
  {
    name: "yt-watch-captiontracks",
    run: async () => {
      const body = await text("https://www.youtube.com/watch?v=jNQXAC9IVRw");
      const m = body.match(/"captionTracks":(\[.*?\])/);
      if (!m) return { count: 0, sample: ["captionTracks bulunamadi"] };
      const tracks = JSON.parse(m[1]) as { baseUrl?: string; languageCode?: string }[];
      return {
        count: tracks.length,
        sample: tracks.slice(0, 3).map((t) => `${t.languageCode}: ${(t.baseUrl ?? "").slice(0, 60)}`),
      };
    },
  },
  {
    name: "yt-timedtext-direct",
    run: async () => {
      const body = await text("https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=json3");
      return { count: body.length > 50 ? 1 : 0, sample: [body.slice(0, 100)] };
    },
  },
  {
    name: "yt-player-meta",
    run: async () => {
      const body = await text("https://www.youtube.com/watch?v=jNQXAC9IVRw");
      const title = body.match(/"title":\{"simpleText":"([^"]+)"/)?.[1];
      const desc = body.match(/"shortDescription":"([^"]{0,80})/)?.[1];
      return { count: title ? 1 : 0, sample: [`${title} | ${desc}`] };
    },
  },
  {
    name: "bluesky-retry",
    run: async (q) => {
      const d = await json<{ posts?: { record?: { text?: string } }[] }>(
        `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=5`
      );
      const h = d.posts ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((x) => (x.record?.text ?? "").slice(0, 60)) };
    },
  },
  {
    name: "youtube-rss-retry",
    run: async () => {
      const body = await text(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"
      );
      const titles = [...body.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
      return { count: Math.max(0, titles.length - 1), sample: titles.slice(1, 4) };
    },
  },
  {
    name: "vimeo-retry",
    run: async () => {
      const d = await json<{ title?: string; author_name?: string }>(
        "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1084537"
      );
      return { count: d.title ? 1 : 0, sample: [`${d.title} — ${d.author_name}`] };
    },
  },
  {
    name: "youtube-search-titles",
    run: async (q) => {
      const body = await text(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
      const ids = [...new Set([...body.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))];
      const titles = [...body.matchAll(/"title":\{"runs":\[\{"text":"([^"]{5,80})"/g)].map((m) => m[1]);
      return { count: ids.length, sample: titles.slice(0, 3) };
    },
  },
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const query = req.nextUrl.searchParams.get("q") ?? "kubernetes";

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
