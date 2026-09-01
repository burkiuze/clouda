import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import {
  searchMastodon,
  searchLemmy,
  searchYouTube,
  videoMetadata,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialPost,
} from "@/lib/social/providers";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { assertUrlAllowed } from "@/lib/core/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SocialBody {
  query?: string;
  platforms?: string[];
  limit?: number;
  /** When set, returns metadata for these video URLs instead of searching. */
  video_urls?: string[];
}

const MAX_VIDEO_URLS = 10;

/**
 * POST /api/v1/social — what people are saying, and what videos exist.
 *
 * Two modes. With `query` it searches the open social platforms; with
 * `video_urls` it returns metadata for videos the caller already has links to.
 *
 * On what is *not* here, so nobody builds on an assumption: X, Instagram,
 * Facebook and Reddit are not reachable without an account or a paid key —
 * Reddit answers 403 to anonymous datacenter traffic, including its RSS view,
 * and so does Bluesky's public AppView. Only platforms that actually replied
 * when measured are listed.
 *
 * Video results carry title, author and thumbnail but no transcript.
 * Transcripts would need YouTube's caption tracks, which are no longer served
 * to anonymous requests from a datacenter — the response says so in
 * `transcript_available` rather than leaving the caller to wonder.
 */
export const POST = withApi(
  { operation: "social", capability: "social", estimateCredits: CREDITS.social },
  async (req: NextRequest, ctx) => {
    const body = await readJson<SocialBody>(req);

    // ---- video metadata mode -------------------------------------------
    if (Array.isArray(body.video_urls) && body.video_urls.length > 0) {
      if (body.video_urls.length > MAX_VIDEO_URLS) {
        throw new CloudaError(
          "invalid_request",
          `Tek istekte en fazla ${MAX_VIDEO_URLS} video adresi sorgulanabilir.`
        );
      }

      const urls = body.video_urls.map((raw) => {
        if (typeof raw !== "string" || !raw.trim()) {
          throw new CloudaError("invalid_request", "Adresler metin olmalı.");
        }
        assertUrlAllowed(raw.trim(), ctx.policy);
        return raw.trim();
      });

      const videos = await Promise.all(urls.map((url) => videoMetadata(url)));
      const found = videos.filter((v): v is NonNullable<typeof v> => v !== null);

      return {
        body: {
          mode: "video_metadata",
          videos: found.map((v) => ({
            url: v.url,
            platform: v.platform,
            title: v.title,
            author: v.author,
            thumbnail: v.thumbnail,
            duration_seconds: v.durationSeconds,
            // Stated explicitly: the platforms stopped serving caption tracks
            // to anonymous datacenter requests, so this is never available.
            transcript_available: false,
          })),
          requested: urls.length,
          resolved: found.length,
          unsupported: urls.filter((u) => !found.some((v) => v.url === u)),
        },
        creditsUsed: CREDITS.social,
        resultCount: found.length,
        label: urls[0],
      };
    }

    // ---- search mode ----------------------------------------------------
    const query = body.query?.trim();
    if (!query) {
      throw new CloudaError(
        "invalid_request",
        "Gövde bir 'query' ya da 'video_urls' alanı içermeli."
      );
    }

    const requested = Array.isArray(body.platforms)
      ? body.platforms.filter((p): p is SocialPlatform =>
          (SOCIAL_PLATFORMS as readonly string[]).includes(p)
        )
      : [...SOCIAL_PLATFORMS];

    if (requested.length === 0) {
      throw new CloudaError(
        "invalid_request",
        `Geçerli platform yok. Desteklenenler: ${SOCIAL_PLATFORMS.join(", ")}.`
      );
    }

    const limit = parseInt_(body.limit, 1, 25, 10);
    const perPlatform = Math.max(3, Math.ceil(limit / requested.length) + 2);

    const runners: Record<SocialPlatform, () => Promise<SocialPost[]>> = {
      mastodon: () => searchMastodon(query, perPlatform),
      lemmy: () => searchLemmy(query, perPlatform),
      youtube: () => searchYouTube(query, perPlatform),
    };

    const degraded: { platform: string; reason: string }[] = [];
    const lists = await Promise.all(
      requested.map(async (platform) => {
        try {
          const posts = await runners[platform]();
          if (posts.length === 0) degraded.push({ platform, reason: "no_results" });
          return posts;
        } catch (err) {
          degraded.push({
            platform,
            reason: err instanceof Error ? err.message.slice(0, 100) : "failed",
          });
          return [];
        }
      })
    );

    // Interleaved so one talkative platform cannot fill the whole page.
    const posts: SocialPost[] = [];
    for (let rank = 0; posts.length < limit; rank++) {
      const before = posts.length;
      for (const list of lists) {
        if (posts.length >= limit) break;
        if (list[rank]) posts.push(list[rank]);
      }
      if (posts.length === before) break;
    }

    return {
      body: {
        mode: "search",
        query,
        platforms: requested,
        posts,
        ...(degraded.length > 0 ? { degraded_platforms: degraded } : {}),
      },
      creditsUsed: CREDITS.social,
      resultCount: posts.length,
      provider: requested.join("+"),
      label: query,
    };
  }
);
