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
    name: "bluesky",
    run: async (q) => {
      const d = await json<{ posts?: { record?: { text?: string }; author?: { handle?: string } }[] }>(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=5`
      );
      const h = d.posts ?? [];
      return {
        count: h.length,
        sample: h.slice(0, 3).map((p) => `@${p.author?.handle}: ${(p.record?.text ?? "").slice(0, 70)}`),
      };
    },
  },
  {
    name: "mastodon-tag",
    run: async (q) => {
      const tag = q.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");
      const d = await json<{ content?: string; account?: { acct?: string } }[]>(
        `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=5`
      );
      return {
        count: d.length,
        sample: d.slice(0, 3).map((p) => `@${p.account?.acct}: ${(p.content ?? "").replace(/<[^>]+>/g, "").slice(0, 70)}`),
      };
    },
  },
  {
    name: "lemmy",
    run: async (q) => {
      const d = await json<{ posts?: { post?: { name?: string } }[] }>(
        `https://lemmy.world/api/v3/search?q=${encodeURIComponent(q)}&type_=Posts&limit=5`
      );
      const h = d.posts ?? [];
      return { count: h.length, sample: h.slice(0, 3).map((p) => p.post?.name ?? "?") };
    },
  },
  {
    name: "reddit-rss",
    run: async (q) => {
      const body = await text(`https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&limit=5`);
      const titles = [...body.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
      return { count: Math.max(0, titles.length - 1), sample: titles.slice(1, 4) };
    },
  },
  {
    name: "youtube-oembed",
    run: async () => {
      const d = await json<{ title?: string; author_name?: string }>(
        `https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}&format=json`
      );
      return { count: d.title ? 1 : 0, sample: [`${d.title} — ${d.author_name}`] };
    },
  },
  {
    name: "youtube-rss-channel",
    run: async () => {
      const body = await text(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw"
      );
      const titles = [...body.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
      return { count: Math.max(0, titles.length - 1), sample: titles.slice(1, 4) };
    },
  },
  {
    name: "vimeo-oembed",
    run: async () => {
      const d = await json<{ title?: string; author_name?: string }>(
        "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871"
      );
      return { count: d.title ? 1 : 0, sample: [`${d.title} — ${d.author_name}`] };
    },
  },
  {
    name: "youtube-search-html",
    run: async (q) => {
      const body = await text(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
      const ids = [...body.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]);
      return { count: new Set(ids).size, sample: [...new Set(ids)].slice(0, 3) };
    },
  },
  {
    name: "nitter-x",
    run: async (q) => {
      const body = await text(`https://nitter.net/search?f=tweets&q=${encodeURIComponent(q)}`);
      const items = [...body.matchAll(/class="tweet-content[^"]*"[^>]*>([^<]{10,})/g)].map((m) => m[1]);
      return { count: items.length, sample: items.slice(0, 3).map((s) => s.slice(0, 70)) };
    },
  },
  {
    name: "tiktok-oembed",
    run: async () => {
      const d = await json<{ title?: string; author_name?: string }>(
        "https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40scout2015%2Fvideo%2F6718335390845095173"
      );
      return { count: d.title ? 1 : 0, sample: [`${d.title} — ${d.author_name}`] };
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
