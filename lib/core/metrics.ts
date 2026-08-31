import { prisma } from "@/lib/prisma";

/**
 * Observability. Every billable operation writes one usage row, which doubles
 * as the metrics store: latency, provider, cache hits, step counts and error
 * codes are all queryable from it without a second system.
 */

export type Operation = "search" | "research" | "browse" | "monitor";

export interface UsageRecord {
  userId: string;
  apiKeyId: string;
  operation: Operation;
  query: string;
  resultCount: number;
  creditsUsed: number;
  provider?: string | null;
  latencyMs: number;
  cacheHit?: boolean;
  steps?: number;
  success: boolean;
  errorCode?: string | null;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await prisma.usageLog.create({
      data: {
        userId: record.userId,
        apiKeyId: record.apiKeyId,
        operation: record.operation,
        query: record.query.slice(0, 500),
        resultCount: record.resultCount,
        creditsUsed: record.creditsUsed,
        provider: record.provider ?? null,
        latencyMs: record.latencyMs,
        cacheHit: record.cacheHit ?? false,
        steps: record.steps ?? 0,
        success: record.success,
        errorCode: record.errorCode ?? null,
      },
    });
  } catch {
    // Metrics must never take a request down with them.
  }

  // Structured line so platform log search can aggregate without the database.
  console.log(
    JSON.stringify({
      evt: "clouda.usage",
      op: record.operation,
      ok: record.success,
      code: record.errorCode ?? null,
      provider: record.provider ?? null,
      ms: record.latencyMs,
      cache: record.cacheHit ?? false,
      steps: record.steps ?? 0,
      credits: record.creditsUsed,
      results: record.resultCount,
    })
  );
}

export interface UsageSummary {
  window: string;
  totals: {
    requests: number;
    credits: number;
    errors: number;
    cacheHits: number;
  };
  byOperation: Record<string, { requests: number; credits: number; avgLatencyMs: number }>;
  providerSuccessRate: Record<string, { calls: number; successRate: number }>;
  cacheHitRate: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Rolls the raw usage rows for a user into the numbers the dashboard shows. */
export async function usageSummary(userId: string, sinceHours = 24): Promise<UsageSummary> {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const logs = await prisma.usageLog.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      operation: true,
      creditsUsed: true,
      latencyMs: true,
      cacheHit: true,
      success: true,
      provider: true,
    },
  });

  const byOperation: UsageSummary["byOperation"] = {};
  const providerStats: Record<string, { calls: number; ok: number }> = {};
  const latencies: number[] = [];
  let credits = 0;
  let errors = 0;
  let cacheHits = 0;

  for (const log of logs) {
    credits += log.creditsUsed;
    if (!log.success) errors++;
    if (log.cacheHit) cacheHits++;
    latencies.push(log.latencyMs);

    const op = (byOperation[log.operation] ??= { requests: 0, credits: 0, avgLatencyMs: 0 });
    op.requests++;
    op.credits += log.creditsUsed;
    op.avgLatencyMs += log.latencyMs;

    if (log.provider) {
      for (const name of log.provider.split("+")) {
        const stat = (providerStats[name] ??= { calls: 0, ok: 0 });
        stat.calls++;
        if (log.success) stat.ok++;
      }
    }
  }

  for (const op of Object.values(byOperation)) {
    op.avgLatencyMs = op.requests > 0 ? Math.round(op.avgLatencyMs / op.requests) : 0;
  }

  const providerSuccessRate: UsageSummary["providerSuccessRate"] = {};
  for (const [name, stat] of Object.entries(providerStats)) {
    providerSuccessRate[name] = {
      calls: stat.calls,
      successRate: stat.calls > 0 ? Number((stat.ok / stat.calls).toFixed(3)) : 0,
    };
  }

  latencies.sort((a, b) => a - b);

  return {
    window: `${sinceHours}h`,
    totals: { requests: logs.length, credits, errors, cacheHits },
    byOperation,
    providerSuccessRate,
    cacheHitRate: logs.length > 0 ? Number((cacheHits / logs.length).toFixed(3)) : 0,
    errorRate: logs.length > 0 ? Number((errors / logs.length).toFixed(3)) : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
  };
}
