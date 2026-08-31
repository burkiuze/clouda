import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/apiKey";
import { usageSummary } from "@/lib/core/metrics";
import { CloudaError, toCloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/usage — what this account has spent and how the platform has
 * been performing for it. Available on every key; costs nothing.
 */
export async function GET(req: NextRequest) {
  try {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) throw new CloudaError("missing_api_key", "API anahtarı gerekiyor.");

    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      include: { user: { select: { credits: true } } },
    });
    if (!apiKey || apiKey.revoked) {
      throw new CloudaError("invalid_api_key", "API anahtarı geçersiz.");
    }

    const hours = Math.min(Math.max(Number(req.nextUrl.searchParams.get("hours") ?? 24), 1), 720);
    const summary = await usageSummary(apiKey.userId, hours);

    return NextResponse.json({
      key: {
        name: apiKey.name,
        prefix: apiKey.keyPrefix,
        capabilities: apiKey.capabilities,
        rate_limit_per_min: apiKey.rateLimitPerMin,
        credit_cap: apiKey.creditCap,
        credits_spent: apiKey.creditsSpent,
      },
      credits_remaining: apiKey.user.credits,
      window: summary.window,
      totals: summary.totals,
      by_operation: summary.byOperation,
      provider_success_rate: summary.providerSuccessRate,
      cache_hit_rate: summary.cacheHitRate,
      error_rate: summary.errorRate,
      latency_ms: { p50: summary.p50LatencyMs, p95: summary.p95LatencyMs },
    });
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}
