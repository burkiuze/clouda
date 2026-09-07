/**
 * What the running process has done, kept in the process.
 *
 * The previous version wrote one row per billable operation, because
 * operations were billed and the bill had to be defensible. Nothing is billed
 * now, so the only remaining question is the operational one: is it working,
 * and how fast. That answer is worth keeping but not worth a database.
 */

export type Operation =
  | "search"
  | "research"
  | "browse"
  | "extract"
  | "answer"
  | "social"
  | "data"
  | "map"
  | "rerank"
  | "chunk";

export interface UsageRecord {
  operation: Operation;
  query: string;
  resultCount: number;
  provider?: string | null;
  latencyMs: number;
  cacheHit?: boolean;
  steps?: number;
  success: boolean;
  errorCode?: string | null;
}

interface OperationStats {
  requests: number;
  errors: number;
  cacheHits: number;
  /** Kept so percentiles are real rather than estimated from an average. */
  latencies: number[];
}

/** Enough samples for a meaningful p95, few enough to never matter for memory. */
const MAX_SAMPLES = 500;

const byOperation = new Map<Operation, OperationStats>();
const providerCalls = new Map<string, { calls: number; ok: number }>();
const startedAt = Date.now();

function statsFor(operation: Operation): OperationStats {
  let stats = byOperation.get(operation);
  if (!stats) {
    stats = { requests: 0, errors: 0, cacheHits: 0, latencies: [] };
    byOperation.set(operation, stats);
  }
  return stats;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  const stats = statsFor(record.operation);
  stats.requests += 1;
  if (!record.success) stats.errors += 1;
  if (record.cacheHit) stats.cacheHits += 1;

  stats.latencies.push(record.latencyMs);
  if (stats.latencies.length > MAX_SAMPLES) stats.latencies.shift();

  if (record.provider) {
    for (const name of record.provider.split("+")) {
      const entry = providerCalls.get(name) ?? { calls: 0, ok: 0 };
      entry.calls += 1;
      if (record.success) entry.ok += 1;
      providerCalls.set(name, entry);
    }
  }

  // One structured line per operation, so a terminal or a log collector can
  // follow what the tool is doing without asking it anything.
  console.log(
    JSON.stringify({
      evt: "clouda.usage",
      op: record.operation,
      ok: record.success,
      code: record.errorCode ?? null,
      provider: record.provider ?? null,
      ms: record.latencyMs,
      cache: record.cacheHit ?? false,
      results: record.resultCount,
    })
  );
}

export interface UsageSummary {
  uptimeSeconds: number;
  totals: { requests: number; errors: number; cacheHits: number };
  byOperation: Record<string, { requests: number; avgLatencyMs: number; p95LatencyMs: number }>;
  providerSuccessRate: Record<string, { calls: number; successRate: number }>;
  cacheHitRate: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function usageSummary(): UsageSummary {
  const operations: UsageSummary["byOperation"] = {};
  const everyLatency: number[] = [];
  let requests = 0;
  let errors = 0;
  let cacheHits = 0;

  for (const [operation, stats] of byOperation) {
    requests += stats.requests;
    errors += stats.errors;
    cacheHits += stats.cacheHits;
    everyLatency.push(...stats.latencies);

    const sorted = [...stats.latencies].sort((a, b) => a - b);
    operations[operation] = {
      requests: stats.requests,
      avgLatencyMs: sorted.length
        ? Math.round(sorted.reduce((sum, ms) => sum + ms, 0) / sorted.length)
        : 0,
      p95LatencyMs: percentile(sorted, 95),
    };
  }

  const providers: UsageSummary["providerSuccessRate"] = {};
  for (const [name, entry] of providerCalls) {
    providers[name] = {
      calls: entry.calls,
      successRate: entry.calls ? Number((entry.ok / entry.calls).toFixed(3)) : 0,
    };
  }

  everyLatency.sort((a, b) => a - b);

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totals: { requests, errors, cacheHits },
    byOperation: operations,
    providerSuccessRate: providers,
    cacheHitRate: requests ? Number((cacheHits / requests).toFixed(3)) : 0,
    errorRate: requests ? Number((errors / requests).toFixed(3)) : 0,
    p50LatencyMs: percentile(everyLatency, 50),
    p95LatencyMs: percentile(everyLatency, 95),
  };
}
