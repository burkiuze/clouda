import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { fixture, delay } from "./helpers/search-fixture.mjs";

test("freshness cache hits use memory and different windows use different keys", async () => {
  const f = fixture();
  const cache = f.load("lib/core/cache.ts");
  const lookup = { namespace: "test", query: "graph", freshnessHours: 1 };
  await cache.cacheSet(lookup, { ok: true }, 100);
  assert.deepEqual((await cache.cacheGet(lookup)).payload, { ok: true });
  assert.notEqual(cache.cacheKey(lookup), cache.cacheKey({ ...lookup, freshnessHours: 24 }));
  assert.notEqual(cache.cacheKey(lookup), cache.cacheKey({ ...lookup, freshnessHours: null }));
});

test("cache key serialization has no separator or case-folding collisions", () => {
  const cache = fixture().load("lib/core/cache.ts");
  assert.notEqual(cache.cacheKey({ namespace: "a|b", query: "c" }), cache.cacheKey({ namespace: "a", query: "b|c" }));
  assert.notEqual(cache.cacheKey({ namespace: "page", query: "/API" }), cache.cacheKey({ namespace: "page", query: "/api" }));
});

test("a fractional freshness window round-trips", async () => {
  const cache = fixture().load("lib/core/cache.ts");
  const lookup = { namespace: "test", query: "graph", freshnessHours: 0.5 };
  await cache.cacheSet(lookup, "answer", 100);
  assert.equal((await cache.cacheGet(lookup)).payload, "answer");
});

test("a sub-minute freshness window never gets a one-minute minimum TTL", async () => {
  const f = fixture();
  const cache = f.load("lib/core/cache.ts");
  const lookup = { namespace: "tiny", query: "graph", freshnessHours: 0.00001 };
  await cache.cacheSet(lookup, "answer", 100);
  await delay(45);
  assert.equal(await cache.cacheGet(lookup), null);
  assert.equal(cache.ttlForIntent("news", 24), 300);
  assert.equal(cache.ttlForIntent("general", 0.001), 3.6);
});

test("explicit invalidation clears both memory and persisted data", async () => {
  const f = fixture();
  const cache = f.load("lib/core/cache.ts");
  const lookup = { namespace: "test", query: "graph" };
  await cache.cacheSet(lookup, "old", 100);
  await cache.cacheInvalidate(lookup);
  assert.equal(await cache.cacheGet(lookup), null);
});

test("the store is bounded and evicts least-recently-used entries", async () => {
  const cache = fixture().load("lib/core/cache.ts");
  const { maxEntries } = cache.cacheStats();

  for (let i = 0; i < maxEntries + 50; i++) {
    await cache.cacheSet({ namespace: "bulk", query: `q${i}` }, i, 100);
  }

  const { entries } = cache.cacheStats();
  assert.ok(entries <= maxEntries, `${entries} girdi, üst sınır ${maxEntries}`);
  // The most recent writes survive; the earliest were evicted.
  assert.equal((await cache.cacheGet({ namespace: "bulk", query: `q${maxEntries + 49}` })).payload, maxEntries + 49);
  assert.equal(await cache.cacheGet({ namespace: "bulk", query: "q0" }), null);
});

test("a cache outage bounds the number of outstanding database reads", async () => {
  const f = fixture({ dbReadMs: 200 });
  const cache = f.load("lib/core/cache.ts");
  await Promise.all(Array.from({ length: 150 }, (_, i) => cache.cacheGet({ namespace: "test", query: String(i) })));
  assert.ok(f.stats.reads <= 64);
  await delay(220);
});

test("background persistence publishes the memory entry synchronously", async () => {
  const f = fixture();
  const cache = f.load("lib/core/cache.ts");
  const lookup = { namespace: "test", query: "graph", freshnessHours: 1 };
  void cache.cacheSet(lookup, "fresh", 100, { background: true });
  assert.equal((await cache.cacheGet(lookup)).payload, "fresh");
  assert.equal(f.stats.reads, 0);
  await f.drain();
});
