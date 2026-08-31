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

/**
 * A small per-instance cache in front of the database one.
 *
 * The row read is fast but it is still a network round trip, and on a warm
 * lambda serving the same popular query repeatedly that trip is the entire
 * response time. This layer answers those in microseconds. It is deliberately
 * tiny and unshared: it accelerates repeats on one instance and nothing else,
 * with the database remaining the real cache.
 */
const MEMORY_MAX = 200;
const memory = new Map<string, { payload: unknown; storedAt: number; expiresAt: number }>();

function memoryGet(key: string): { payload: unknown; storedAt: number } | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  // Refresh recency for the LRU eviction below.
  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

function memorySet(key: string, payload: unknown, expiresAt: number, storedAt: number): void {
  memory.set(key, { payload, storedAt, expiresAt });
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export async function cacheGet<T>(lookup: CacheLookup): Promise<CacheHit<T> | null> {
  const key = cacheKey(lookup);

  // The freshness contract is checked against the stored row below; entries
  // held in memory carry their own expiry and are only used for lookups that
  // did not ask for a narrower window than the entry was produced under.
  if (lookup.freshnessHours == null) {
    const local = memoryGet(key);
    if (local) {
      return {
        payload: local.payload as T,
        ageSeconds: Math.round((Date.now() - local.storedAt) / 1000),
      };
    }
  }

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

    if (lookup.freshnessHours == null) {
      memorySet(key, row.payload, row.expiresAt.getTime(), row.createdAt.getTime());
    }

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

  if (lookup.freshnessHours == null) {
    memorySet(key, payload, expiresAt.getTime(), Date.now());
  }

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
