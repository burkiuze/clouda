import { prisma } from "@/lib/prisma";
import { rateLimit as memoryLimit } from "@/lib/rateLimit";

/**
 * Rate limiting that survives serverless.
 *
 * The in-memory limiter this replaces was decorative: every Vercel lambda gets
 * its own heap, so an attacker spreading requests across cold starts never hit
 * a shared counter at all. Counters live in Postgres instead, in fixed windows
 * keyed by action and subject.
 */

export interface LimitRule {
  /** What is being limited, e.g. "register" or "login". */
  action: string;
  /** Maximum hits allowed inside one window. */
  limit: number;
  windowSeconds: number;
}

export interface LimitVerdict {
  allowed: boolean;
  /** Hits recorded in the current window, including this one. */
  count: number;
  limit: number;
  /** Seconds until the window rolls over. */
  retryAfter: number;
}

/**
 * Counts one hit against `subject` and reports whether it is allowed.
 *
 * Fails closed: if the counter cannot be read, the request is refused rather
 * than waved through, because every route guarded here needs the database
 * anyway. The single exception is a deployment with no database configured at
 * all, where the public demo is meant to keep working — there it degrades to
 * the per-instance limiter rather than losing all protection.
 */
export async function consume(rule: LimitRule, subject: string): Promise<LimitVerdict> {
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = new Date(windowStart + windowMs);
  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));

  if (!process.env.DATABASE_URL) {
    const allowed = memoryLimit(`${rule.action}:${subject}`, rule.limit, windowMs);
    return { allowed, count: allowed ? 1 : rule.limit + 1, limit: rule.limit, retryAfter };
  }

  const id = `${rule.action}:${subject}:${windowStart}`;

  try {
    // Prisma compiles this to INSERT ... ON CONFLICT DO UPDATE, so concurrent
    // lambdas increment the same row without losing counts.
    const row = await prisma.rateLimit.upsert({
      where: { id },
      create: { id, count: 1, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });

    return {
      allowed: row.count <= rule.limit,
      count: row.count,
      limit: rule.limit,
      retryAfter,
    };
  } catch {
    return { allowed: false, count: rule.limit + 1, limit: rule.limit, retryAfter };
  }
}

/** Reads the current count without recording a hit. */
export async function peek(rule: LimitRule, subject: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  try {
    const row = await prisma.rateLimit.findUnique({
      where: { id: `${rule.action}:${subject}:${windowStart}` },
      select: { count: true },
    });
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Clears a subject's counter, e.g. after a successful sign-in. */
export async function reset(rule: LimitRule, subject: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  try {
    await prisma.rateLimit.delete({
      where: { id: `${rule.action}:${subject}:${windowStart}` },
    });
  } catch {
    // Nothing recorded for this window; nothing to clear.
  }
}

/** Drops windows that have rolled over. Called from the scheduled sweep. */
export async function purgeExpired(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

/**
 * The limits themselves, in one place so they can be reviewed together.
 *
 * Sign-up is the tightest because every account is handed free credits: an
 * unthrottled endpoint there is a free-compute faucet, not just spam.
 */
export const LIMITS = {
  register: { action: "register", limit: 3, windowSeconds: 3600 },
  registerBurst: { action: "register_burst", limit: 8, windowSeconds: 86400 },
  loginByIp: { action: "login_ip", limit: 20, windowSeconds: 900 },
  loginByAccount: { action: "login_account", limit: 8, windowSeconds: 900 },
  demoSearch: { action: "demo", limit: 8, windowSeconds: 300 },
  keyCreate: { action: "key_create", limit: 10, windowSeconds: 3600 },
} satisfies Record<string, LimitRule>;
