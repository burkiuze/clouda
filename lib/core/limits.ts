/**
 * A rate limiter for the one case a local tool still has: something on the
 * network reaching an endpoint that fans out to dozens of third parties.
 *
 * It used to be database-backed, because serverless instances share nothing
 * and an in-memory counter reset on every cold start. One long-lived process
 * has no such problem, so the counter lives in memory where it belongs.
 */

export interface LimitRule {
  action: string;
  limit: number;
  windowSeconds: number;
}

export interface LimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Keeps the map from growing without bound if subjects are many and varied. */
const MAX_TRACKED = 5000;

export async function consume(rule: LimitRule, subject: string): Promise<LimitVerdict> {
  const now = Date.now();
  const key = `${rule.action}:${subject}`;
  const windowMs = rule.windowSeconds * 1000;

  let window = windows.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    if (windows.size >= MAX_TRACKED) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    windows.set(key, window);
  }

  const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  if (window.count >= rule.limit) {
    return { allowed: false, remaining: 0, retryAfter };
  }

  window.count += 1;
  return { allowed: true, remaining: rule.limit - window.count, retryAfter };
}

export function purgeExpired(): number {
  const now = Date.now();
  let dropped = 0;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

export const LIMITS = {
  /** The unauthenticated search box on the local UI. */
  demoSearch: { action: "demo", limit: 30, windowSeconds: 60 },
  /** Diagnostics reach roughly thirty third parties per call. */
  diagnostics: { action: "diag", limit: 12, windowSeconds: 3600 },
} satisfies Record<string, LimitRule>;
