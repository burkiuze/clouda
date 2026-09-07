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
  assert.equal(f.stats.reads, 0);
  assert.notEqual(cache.cacheKey(lookup), cache.cacheKey({ ...lookup, freshnessHours: 24 }));
  assert.notEqual(cache.cacheKey(lookup), cache.cacheKey({ ...lookup, freshnessHours: null }));
});

test("cache key serialization has no separator or case-folding collisions", () => {
  const cache = fixture().load("lib/core/cache.ts");
  assert.notEqual(cache.cacheKey({ namespace: "a|b", query: "c" }), cache.cacheKey({ namespace: "a", query: "b|c" }));
  assert.notEqual(cache.cacheKey({ namespace: "page", query: "/API" }), cache.cacheKey({ namespace: "page", query: "/api" }));
});

test("fractional windows persist without writing a float to the legacy Int column", async () => {
  const f = fixture();
  const cache = f.load("lib/core/cache.ts");
  const lookup = { namespace: "test", query: "graph", freshnessHours: 0.5 };
  await cache.cacheSet(lookup, "answer", 100);
  assert.equal(f.rows.get(cache.cacheKey(lookup)).freshnessH, null);
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

test("slow database misses are bounded and concurrent reads share one operation", async () => {
  const f = fixture({ dbReadMs: 250 });
  const cache = f.load("lib/core/cache.ts");
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.cacheGet({ namespace: "test", query: "graph" })));
  assert.ok(performance.now() - started < 180);
  assert.ok(results.every(r => r === null));
  assert.equal(f.stats.reads, 1);
  await delay(260);
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
