import { NextResponse } from "next/server";
import { healthSnapshot } from "@/lib/core/breaker";
import { cacheStats } from "@/lib/core/cache";
import { usageSummary } from "@/lib/core/metrics";
import { tokenConfigured } from "@/lib/api/gateway";
import { NEWS_FEED_COUNT, TOTAL_SOURCE_COUNT } from "@/lib/constants";

/**
 * One request that answers "is this thing working?".
 *
 * It used to check a database connection and a session secret, because without
 * those the product could not sign anyone in. There is nothing to sign in to
 * now and nothing to configure before searching, so the question has changed:
 * not "is it wired up" but "what has it seen, and which sources are answering".
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const sources = healthSnapshot();
  const usage = usageSummary();

  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.2.0",
    uptime_seconds: usage.uptimeSeconds,

    // Nothing is required to run this. Listing what is optional and whether it
    // is set is more useful than a pass/fail on things that cannot fail.
    configuration: {
      shared_token: tokenConfigured(),
      searxng: Boolean(process.env.SEARXNG_BASE_URL),
      marginalia_key: Boolean(process.env.MARGINALIA_API_KEY),
      github_token: Boolean(process.env.GITHUB_TOKEN),
      contact_email: Boolean(process.env.CLOUDA_CONTACT_EMAIL),
    },

    sources: {
      configured: TOTAL_SOURCE_COUNT,
      news_feeds: NEWS_FEED_COUNT,
      observed: sources.length,
      open_circuits: sources.filter((s) => s.state === "open").map((s) => s.source),
      detail: sources,
    },

    cache: cacheStats(),

    usage: {
      requests: usage.totals.requests,
      errors: usage.totals.errors,
      error_rate: usage.errorRate,
      cache_hit_rate: usage.cacheHitRate,
      p50_latency_ms: usage.p50LatencyMs,
      p95_latency_ms: usage.p95LatencyMs,
      by_operation: usage.byOperation,
      provider_success_rate: usage.providerSuccessRate,
    },

    note:
      "Kaynak sağlığı, önbellek ve sayaçlar bu sürecin belleğindedir; " +
      "yeniden başlatınca sıfırlanır.",
  });
}
