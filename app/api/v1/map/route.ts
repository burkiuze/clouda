import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { CloudaError } from "@/lib/core/errors";
import { mapSite } from "@/lib/crawl/sitemap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  url?: string;
  site?: string;
  limit?: number;
  path?: string;
}

/**
 * POST /api/v1/map — every URL a site publishes about itself.
 *
 * An agent told to "read the docs for X" has one address and needs the other
 * three hundred. Crawling to find them is slow, rude, and mostly rediscovers
 * what the site already lists: robots.txt names the sitemaps, and the sitemaps
 * name the pages, with the dates they last changed.
 *
 * Reading a site's own index is one or two requests where a crawl would be
 * hundreds, which is why this is priced as a single fetch. Feed the result to
 * /api/v1/extract to read the pages that matter.
 */
export const POST = withApi(
  { operation: "extract" },
  async (req: NextRequest, ctx) => {
    const body = await readJson<Body>(req);

    const target = (body.url ?? body.site)?.trim();
    if (!target) throw new CloudaError("invalid_request", "Gövde bir 'url' alanı içermeli.");
    if (target.length > 300) throw new CloudaError("invalid_request", "'url' çok uzun.");

    const path = body.path?.trim();
    if (path && path.length > 120) {
      throw new CloudaError("invalid_request", "'path' çok uzun.");
    }

    const result = await mapSite(target, {
      limit: parseInt_(body.limit, 1, 5000, 200),
      pathPrefix: path || undefined,
      policy: ctx.policy,
    });

    if (result.urls.length === 0) {
      throw new CloudaError(
        "not_found",
        "Bu sitede site haritası bulunamadı ve ana sayfasından bağlantı çıkarılamadı.",
        { site: result.site, robots_found: result.robotsFound }
      );
    }

    return {
      body: {
        site: result.site,
        count: result.urls.length,
        truncated: result.truncated,
        // Where the list came from, so a caller can tell a site's own index
        // from links scraped off its homepage — they are not equally complete.
        discovery: {
          robots_txt: result.robotsFound,
          sitemaps_read: result.sitemaps,
          method: result.urls[0]?.via ?? "sitemap",
        },
        ...(path ? { path_filter: path } : {}),
        urls: result.urls.map((entry) => ({
          url: entry.url,
          last_modified: entry.lastModified,
          via: entry.via,
        })),
      },
      resultCount: result.urls.length,
      provider: "sitemap",
      cacheHit: false,
      label: result.site,
    };
  }
);
