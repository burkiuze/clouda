import { safeFetch } from "@/lib/core/http";

/**
 * Social and video discovery.
 *
 * Which platforms are here was decided by measuring them from this
 * deployment's egress, and the list is short because most of social media is
 * closed to anonymous datacenter traffic. Measured refusals: Bluesky's public
 * AppView (403 on both api.bsky.app and public.api.bsky.app), Reddit including
 * its RSS view (403), YouTube's channel feeds (404), and Nitter, which is
 * defunct. X, Instagram, Facebook and TikTok search all require an account or
 * a paid key. None of them are listed, because a source that never answers
 * still costs every request a timeout.
 *
 * What is left is genuinely open: the fediverse, which was built to be read
 * without an account, plus YouTube's search results page and the oEmbed
 * endpoints platforms publish for link previews.
 */

export interface SocialPost {
  platform: string;
  /** Post text, or the video title for a video result. */
  text: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  /** Set for video results. */
  videoId?: string;
  thumbnail?: string | null;
}

const TIMEOUT = 3000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await safeFetch(url, { trusted: true, timeoutMs: TIMEOUT });
    if (res.status >= 400) return null;
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[m] ?? " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mastodon's public hashtag timeline. Search proper needs a token, but tag
 * timelines are open by design, so the query's first usable word becomes the
 * tag. Reading one instance's federated view is enough: mastodon.social sees
 * posts from everywhere its users follow.
 */
export async function searchMastodon(query: string, limit: number): Promise<SocialPost[]> {
  const tag = query
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .find((w) => w.length >= 3);
  if (!tag) return [];

  const data = await getJson<
    {
      content?: string;
      url?: string;
      created_at?: string;
      account?: { acct?: string };
    }[]
  >(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`);

  return (data ?? [])
    .filter((p) => p.url && p.content)
    .slice(0, limit)
    .map((p) => ({
      platform: "mastodon",
      text: stripHtml(p.content as string),
      url: p.url as string,
      author: p.account?.acct ? `@${p.account.acct}` : null,
      publishedAt: p.created_at ?? null,
    }));
}

/** Lemmy's search is fully open and covers threaded discussion. */
export async function searchLemmy(query: string, limit: number): Promise<SocialPost[]> {
  const data = await getJson<{
    posts?: {
      post?: { name?: string; body?: string; ap_id?: string; published?: string };
      creator?: { name?: string };
    }[];
  }>(
    `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts` +
      `&sort=TopMonth&limit=${limit}`
  );

  return (data?.posts ?? [])
    .filter((p) => p.post?.name && p.post?.ap_id)
    .slice(0, limit)
    .map((p) => ({
      platform: "lemmy",
      text: [p.post?.name, stripHtml(p.post?.body ?? "").slice(0, 240)].filter(Boolean).join(" — "),
      url: p.post?.ap_id as string,
      author: p.creator?.name ? `@${p.creator.name}` : null,
      publishedAt: p.post?.published ?? null,
    }));
}

/**
 * YouTube search, read off the results page.
 *
 * There is no key-free search API, but the results page embeds its data as
 * JSON and answers from a datacenter range. `hl`/`gl` are pinned because the
 * page otherwise localises to wherever the function happens to run — measured
 * from Frankfurt it came back in German.
 */
export async function searchYouTube(query: string, limit: number): Promise<SocialPost[]> {
  try {
    const res = await safeFetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`,
      { trusted: true, timeoutMs: TIMEOUT }
    );
    if (res.status >= 400) return [];

    // videoRenderer blocks pair an id with the title shown for it; taking them
    // from the same block keeps titles attached to the right video, which
    // scraping the two patterns separately does not.
    const blocks = [...res.body.matchAll(/"videoRenderer":\{(.*?)"trackingParams"/g)];
    const seen = new Set<string>();
    const out: SocialPost[] = [];

    for (const [, block] of blocks) {
      if (out.length >= limit) break;
      const id = block.match(/"videoId":"([\w-]{11})"/)?.[1];
      const title = block.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);

      const owner = block.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)?.[1];
      const published = block.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)?.[1];

      out.push({
        platform: "youtube",
        text: JSON.parse(`"${title}"`),
        url: `https://www.youtube.com/watch?v=${id}`,
        author: owner ? JSON.parse(`"${owner}"`) : null,
        // The page gives "3 years ago", not a date; kept as-is rather than
        // converted into a timestamp that would imply precision it lacks.
        publishedAt: null,
        videoId: id,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        ...(published ? { relativeAge: published } : {}),
      } as SocialPost);
    }
    return out;
  } catch {
    return [];
  }
}

export interface VideoMeta {
  url: string;
  platform: string;
  title: string;
  author: string | null;
  thumbnail: string | null;
  /** Present only where the platform's oEmbed reports it. */
  durationSeconds: number | null;
}

const OEMBED: { match: RegExp; platform: string; endpoint: (url: string) => string }[] = [
  {
    match: /(?:youtube\.com|youtu\.be)/i,
    platform: "youtube",
    endpoint: (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`,
  },
  {
    match: /vimeo\.com/i,
    platform: "vimeo",
    endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  },
  {
    match: /tiktok\.com/i,
    platform: "tiktok",
    endpoint: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  },
];

/**
 * Video metadata from the oEmbed endpoint the platform publishes for link
 * previews. Title, author and thumbnail only — the transcript is not
 * obtainable here, see the note in the route.
 */
export async function videoMetadata(url: string): Promise<VideoMeta | null> {
  const entry = OEMBED.find((o) => o.match.test(url));
  if (!entry) return null;

  const data = await getJson<{
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
    duration?: number;
  }>(entry.endpoint(url));
  if (!data?.title) return null;

  return {
    url,
    platform: entry.platform,
    title: data.title,
    author: data.author_name ?? null,
    thumbnail: data.thumbnail_url ?? null,
    durationSeconds: typeof data.duration === "number" ? data.duration : null,
  };
}

export const SOCIAL_PLATFORMS = ["mastodon", "lemmy", "youtube"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
