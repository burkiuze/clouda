import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { fetchAndExtract } from "@/lib/search/extract";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { assertUrlAllowed } from "@/lib/core/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ExtractBody {
  urls?: string[];
  url?: string;
  max_chars?: number;
}

const MAX_URLS = 10;
const CONCURRENCY = 5;

/**
 * POST /api/v1/extract — turn known URLs into clean, model-ready text.
 *
 * Search answers "what should I read"; this answers "what does this page
 * actually say", for the very common case where an agent already has links
 * from somewhere else and only needs the boilerplate stripped. Every URL goes
 * through the same SSRF policy as the rest of the platform, so a caller cannot
 * use it to reach into a private network.
 */
export const POST = withApi(
  { operation: "extract", estimateCredits: CREDITS.extractBase + CREDITS.extractPerUrl * MAX_URLS },
  async (req: NextRequest, ctx) => {
    const body = await readJson<ExtractBody>(req);

    const requested = body.urls ?? (body.url ? [body.url] : []);
    if (!Array.isArray(requested) || requested.length === 0) {
      throw new CloudaError("invalid_request", "Gövde bir 'url' ya da 'urls' alanı içermeli.");
    }
    if (requested.length > MAX_URLS) {
      throw new CloudaError(
        "invalid_request",
        `Tek istekte en fazla ${MAX_URLS} adres çıkarılabilir.`
      );
    }

    const maxChars = Math.min(20_000, Math.max(200, Number(body.max_chars) || 4000));

    // Reject the whole request on a bad address rather than silently dropping
    // it: a caller that asked for five pages should not get four without being
    // told which one was refused and why.
    const urls = requested.map((raw) => {
      if (typeof raw !== "string" || !raw.trim()) {
        throw new CloudaError("invalid_request", "Adresler metin olmalı.");
      }
      assertUrlAllowed(raw.trim(), ctx.policy);
      return raw.trim();
    });

    const pages: Record<string, unknown>[] = [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        urls.slice(i, i + CONCURRENCY).map(async (url) => {
          const page = await fetchAndExtract(url, { policy: ctx.policy, timeoutMs: 10_000 });
          if (!page) {
            return { url, ok: false, error: "unreadable", content: null };
          }
          return {
            url: page.url,
            ok: true,
            title: page.title,
            content: page.content.slice(0, maxChars),
            published_at: page.publishedAt,
            updated_at: page.updatedAt,
            bytes: page.bytes,
            truncated: page.content.length > maxChars,
          };
        })
      );
      pages.push(...batch);
    }

    const succeeded = pages.filter((p) => p.ok).length;

    return {
      body: {
        pages,
        requested: urls.length,
        extracted: succeeded,
      },
      // Only readable pages are charged for.
      creditsUsed: CREDITS.extractBase + CREDITS.extractPerUrl * succeeded,
      resultCount: succeeded,
      label: urls[0],
    };
  }
);
