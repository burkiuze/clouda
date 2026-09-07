import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { offload } from "@/lib/core/offload";
import { within } from "@/lib/core/async";

export interface CacheLookup {
  namespace: string;
  query: string;
  locale?: string;
  maxResults?: number;
  freshnessHours?: number | null;
}

/** Versioned, unambiguous identity. Preserve case-sensitive URLs/identifiers. */
export function cacheKey(lookup: CacheLookup): string {
  return createHash("sha256").update(JSON.stringify([
    "v2", lookup.namespace, lookup.query.trim(), lookup.locale ?? "",
    lookup.maxResults ?? null, lookup.freshnessHours ?? null,
  ])).digest("hex");
}

export interface CacheHit<T> { payload: T; ageSeconds: number }

const MEMORY_MAX = 200;
const MAX_PENDING_READS = 64;
const CACHE_READ_BUDGET_MS = 60;
const memory = new Map<string, { payload: unknown; storedAt: number; expiresAt: number }>();
const reads = new Map<string, Promise<CacheHit<unknown> | null>>();
// A late database read must not resurrect an entry invalidated or overwritten
// while it was in flight. This epoch is local, just like the memory cache.
let generation = 0;

function memoryGet<T>(key: string): CacheHit<T> | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { memory.delete(key); return null; }
  memory.delete(key);
  memory.set(key, entry);
  return { payload: entry.payload as T, ageSeconds: Math.max(0, (Date.now() - entry.storedAt) / 1000) };
}

function memorySet(key: string, payload: unknown, expiresAt: number, storedAt: number): void {
  memory.delete(key);
  memory.set(key, { payload, storedAt, expiresAt });
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
}

/** Memory first (including freshness windows); a slow database is a cache miss.
 * Pending reads are shared and capped so a cache outage cannot fill the pool
 * with one additional query per incoming search. Late successful reads warm L1.
 */
export async function cacheGet<T>(lookup: CacheLookup): Promise<CacheHit<T> | null> {
  const key = cacheKey(lookup);
  const local = memoryGet<T>(key);
  if (local) return local;
  let pending = reads.get(key);
  if (!pending) {
    if (reads.size >= MAX_PENDING_READS) return null;
    const epoch = generation;
    pending = (async (): Promise<CacheHit<unknown> | null> => {
      try {
        const row = await prisma.searchCache.findUnique({ where: { cacheKey: key } });
        if (epoch !== generation) return memoryGet(key);
        if (!row) return null;
        let expiresAt = row.expiresAt.getTime();
        if (lookup.freshnessHours != null) {
          // The v2 key includes the exact window, including fractional hours.
          expiresAt = Math.min(expiresAt, row.createdAt.getTime() + lookup.freshnessHours * 3_600_000);
        }
        if (expiresAt <= Date.now()) return null;
        memorySet(key, row.payload, expiresAt, row.createdAt.getTime());
        offload(() => prisma.searchCache.update({ where: { id: row.id }, data: { hits: { increment: 1 } } }));
        return memoryGet(key);
      } catch { return null; }
    })();
    reads.set(key, pending);
    const work = pending;
    void work.finally(() => { if (reads.get(key) === work) reads.delete(key); });
  }
  return within(pending as Promise<CacheHit<T> | null>, CACHE_READ_BUDGET_MS);
}

/** Populate memory immediately; optionally persist after the response. */
export async function cacheSet<T>(
  lookup: CacheLookup, payload: T, ttlSeconds: number, options: { background?: boolean } = {}
): Promise<void> {
  const key = cacheKey(lookup);
  const storedAt = Date.now();
  const ttl = lookup.freshnessHours == null ? ttlSeconds : Math.min(ttlSeconds, lookup.freshnessHours * 3600);
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  const expiresAt = new Date(storedAt + ttl * 1000);
  // Existing schemas store this legacy metadata column as Int. The exact
  // fractional/large window remains in the v2 key; no migration is required.
  const freshnessH = lookup.freshnessHours != null && Number.isInteger(lookup.freshnessHours) &&
    lookup.freshnessHours <= 2_147_483_647 ? lookup.freshnessHours : null;
  generation++;
  memorySet(key, payload, expiresAt.getTime(), storedAt);
  const persist = async () => {
    try {
      await prisma.searchCache.upsert({
        where: { cacheKey: key },
        create: { cacheKey: key, query: lookup.query.slice(0, 500), payload: payload as never,
          freshnessH, expiresAt, createdAt: new Date(storedAt) },
        update: { payload: payload as never, freshnessH,
          expiresAt, createdAt: new Date(storedAt), hits: 0 },
      });
    } catch { /* Caching is an optimisation, never a requirement. */ }
  };
  if (options.background) offload(persist);
  else await persist();
}

/** Invalidate one exact lookup, or purge expired entries when omitted. */
export async function cacheInvalidate(lookup?: Partial<CacheLookup>): Promise<number> {
  generation++;
  const key = lookup?.namespace && lookup.query ? cacheKey(lookup as CacheLookup) : null;
  if (key) memory.delete(key);
  else for (const [k, entry] of memory) if (entry.expiresAt <= Date.now()) memory.delete(k);
  try {
    const res = await prisma.searchCache.deleteMany({
      where: key ? { cacheKey: key } : { expiresAt: { lte: new Date() } },
    });
    return res.count;
  } catch { return 0; }
}

/** Volatile subjects expire quickly, even when the requested date range is wide. */
export function ttlForIntent(intent: string, freshnessHours?: number | null): number {
  const ttl = intent === "news" || intent === "finance" ? 300 : intent === "product" ? 1800 :
    intent === "technical" || intent === "academic" ? 86400 : 3600;
  return freshnessHours == null ? ttl : Math.min(ttl, freshnessHours * 3600);
}
