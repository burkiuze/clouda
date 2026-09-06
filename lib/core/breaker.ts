/**
 * Per-source circuit breaker and health scoreboard.
 *
 * The fan-out already tolerates a source that fails: it falls back to that
 * source's last answer and reports it as degraded. What it did not do was
 * *learn*. A source that has failed its last five calls was still asked on
 * every query, and still charged the query its full deadline before being
 * given up on — so a source being down cost latency on every request rather
 * than on the first few.
 *
 * The breaker closes that loop. After a run of failures a source is skipped
 * outright for a cooldown, then let through one request at a time until it
 * proves itself. The cost of a down source falls from "every query pays its
 * deadline" to "one query in the cooldown does".
 *
 * Scope note, stated plainly: this state lives in one serverless instance's
 * memory. It is not shared, and a cold start begins from a clean slate. That
 * is the right trade here — a shared breaker would need a database round trip
 * per source per query, which costs more latency than it saves — and it still
 * works, because an instance serving a burst of traffic learns within the
 * first couple of requests. The durable half of this is the provider cache,
 * which is shared and does survive.
 */

export interface SourceHealth {
  /** Consecutive failures since the last success. */
  failures: number;
  /** When the circuit opened, or 0 while it is closed. */
  openedAt: number;
  /** True while one trial request is in flight against a recovering source. */
  probing: boolean;
  calls: number;
  successes: number;
  /** Exponential moving average of successful-call latency, in ms. */
  avgLatencyMs: number;
  lastError: string | null;
  lastOkAt: number;
}

/** Failures in a row before a source is taken out of the rotation. */
const FAILURE_THRESHOLD = 4;

/**
 * How long a source stays out. Doubles for each further failed trial, so a
 * source that is briefly unhappy returns quickly and one that is genuinely
 * down stops being asked.
 */
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

/** Weight of the newest sample in the latency average. */
const EMA_ALPHA = 0.3;

const health = new Map<string, SourceHealth>();

function entry(name: string): SourceHealth {
  let current = health.get(name);
  if (!current) {
    current = {
      failures: 0,
      openedAt: 0,
      probing: false,
      calls: 0,
      successes: 0,
      avgLatencyMs: 0,
      lastError: null,
      lastOkAt: 0,
    };
    health.set(name, current);
  }
  return current;
}

function cooldownFor(failures: number): number {
  const overshoot = Math.max(0, failures - FAILURE_THRESHOLD);
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** overshoot);
}

/**
 * Whether a source should be skipped entirely for this request.
 *
 * Returns a reason rather than a bare boolean so the caller can report it in
 * `degraded_providers` — a source that was never asked and a source that was
 * asked and failed are different facts, and telling them apart is the whole
 * point of that field.
 */
export function circuitOpen(name: string): { open: boolean; reason?: string; retryInMs?: number } {
  const state = health.get(name);
  if (!state || state.openedAt === 0) return { open: false };

  const elapsed = Date.now() - state.openedAt;
  const cooldown = cooldownFor(state.failures);

  if (elapsed >= cooldown) {
    // Cooldown served: let exactly one request through to test the water.
    if (!state.probing) {
      state.probing = true;
      return { open: false };
    }
    // A trial is already in flight; everyone else still waits.
    return { open: true, reason: "circuit_open (deneme isteği sürüyor)", retryInMs: 0 };
  }

  return {
    open: true,
    reason: `circuit_open (${Math.ceil((cooldown - elapsed) / 1000)}sn sonra yeniden denenecek)`,
    retryInMs: cooldown - elapsed,
  };
}

export function recordSuccess(name: string, latencyMs: number): void {
  const state = entry(name);
  state.calls += 1;
  state.successes += 1;
  state.failures = 0;
  state.openedAt = 0;
  state.probing = false;
  state.lastOkAt = Date.now();
  state.lastError = null;
  state.avgLatencyMs =
    state.avgLatencyMs === 0
      ? latencyMs
      : Math.round(state.avgLatencyMs * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA);
}

export function recordFailure(name: string, reason: string): void {
  const state = entry(name);
  state.calls += 1;
  state.failures += 1;
  state.probing = false;
  state.lastError = reason.slice(0, 120);

  // Re-open on a failed trial too, which is what makes the cooldown grow.
  if (state.failures >= FAILURE_THRESHOLD) state.openedAt = Date.now();
}

export interface HealthReport {
  source: string;
  state: "closed" | "open";
  calls: number;
  successRate: number;
  avgLatencyMs: number;
  consecutiveFailures: number;
  lastError: string | null;
  secondsSinceLastSuccess: number | null;
}

/** What this instance currently believes about every source it has called. */
export function healthSnapshot(): HealthReport[] {
  return [...health.entries()]
    .map(([source, s]) => ({
      source,
      state: (s.openedAt === 0 ? "closed" : "open") as "closed" | "open",
      calls: s.calls,
      successRate: s.calls > 0 ? Number((s.successes / s.calls).toFixed(3)) : 0,
      avgLatencyMs: s.avgLatencyMs,
      consecutiveFailures: s.failures,
      lastError: s.lastError,
      secondsSinceLastSuccess: s.lastOkAt ? Math.round((Date.now() - s.lastOkAt) / 1000) : null,
    }))
    .sort((a, b) => a.successRate - b.successRate || b.calls - a.calls);
}

/** Test seam, and a way for an operator to force a retry. */
export function resetHealth(name?: string): void {
  if (name) health.delete(name);
  else health.clear();
}
