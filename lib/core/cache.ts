import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Search-result cache. Serverless instances are short-lived and don't share
 * memory, so the cache lives in Postgres: a repeated question costs a row read
 * instead of a provider call.
 *
 * Freshness is part of the key's semantics rather than only its TTL. A row
 * produced for a 7-day window cannot answer a request that asks for the last
 * hour, so `get` compares the stored window against the requested one.
 */

export interface CacheLookup {
  namespace: string;
  query: string;
  locale?: string;
  maxResults?: number;
  /** Requested freshness window in hours, if the caller set one. */
  freshnessHours?: number | null;
}

export function cacheKey(lookup: CacheLookup): string {
  const normalised = [
    lookup.namespace,
    lookup.query.trim().toLowerCase().replace(/\s+/g, " "),
    lookup.locale ?? "",
    String(lookup.maxResults ?? ""),
  ].join("|");
  return createHash("sha256").update(normalised).digest("hex");
}

export interface CacheHit<T> {
  payload: T;
  ageSeconds: number;
}

export async function cacheGet<T>(lookup: CacheLookup): Promise<CacheHit<T> | null> {
  const key = cacheKey(lookup);

  try {
    const row = await prisma.searchCache.findUnique({ where: { cacheKey: key } });
    if (!row) return null;

    if (row.expiresAt.getTime() <= Date.now()) {
      await prisma.searchCache.delete({ where: { id: row.id } }).catch(() => {});
      return null;
    }

    // A row is only usable when it is at least as fresh as the caller asked for.
    if (lookup.freshnessHours != null) {
      const ageHours = (Date.now() - row.createdAt.getTime()) / 3_600_000;
      if (ageHours > lookup.freshnessHours) return null;
      if (row.freshnessH != null && row.freshnessH > lookup.freshnessHours) return null;
    }

    await prisma.searchCache
      .update({ where: { id: row.id }, data: { hits: { increment: 1 } } })
      .catch(() => {});

    return {
      payload: row.payload as T,
      ageSeconds: Math.round((Date.now() - row.createdAt.getTime()) / 1000),
    };
  } catch {
    // A cache miss is always a safe answer; never fail a request over it.
    return null;
  }
}

export async function cacheSet<T>(
  lookup: CacheLookup,
  payload: T,
  ttlSeconds: number
): Promise<void> {
  const key = cacheKey(lookup);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    await prisma.searchCache.upsert({
      where: { cacheKey: key },
      create: {
        cacheKey: key,
        query: lookup.query.slice(0, 500),
        payload: payload as never,
        freshnessH: lookup.freshnessHours ?? null,
        expiresAt,
      },
      update: {
        payload: payload as never,
        freshnessH: lookup.freshnessHours ?? null,
        expiresAt,
        createdAt: new Date(),
        hits: 0,
      },
    });
  } catch {
    // Caching is an optimisation, not a requirement.
  }
}

/** Drops cached answers for a query, or the whole namespace when omitted. */
export async function cacheInvalidate(lookup?: Partial<CacheLookup>): Promise<number> {
  try {
    if (lookup?.namespace && lookup.query) {
      const res = await prisma.searchCache.deleteMany({
        where: { cacheKey: cacheKey(lookup as CacheLookup) },
      });
      return res.count;
    }
    const res = await prisma.searchCache.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return res.count;
  } catch {
    return 0;
  }
}

/**
 * TTL policy: volatile subjects expire quickly, reference material lasts.
 * Returns seconds.
 */
export function ttlForIntent(intent: string, freshnessHours?: number | null): number {
  if (freshnessHours != null) {
    // Never hold a row longer than the window it claims to satisfy.
    return Math.max(60, Math.min(freshnessHours * 3600, 6 * 3600));
  }
  switch (intent) {
    case "news":
    case "finance":
      return 5 * 60;
    case "product":
      return 30 * 60;
    case "technical":
    case "academic":
      return 24 * 3600;
    default:
      return 3600;
  }
}
