import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { fixture, delay } from "./helpers/search-fixture.mjs";

test("ten concurrent identical requests execute one provider fan-out", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 10 }, () =>
    f.searchWeb("graph database", { includeContent: false })));
  assert.equal(f.stats.providerCalls, 4);
  assert.ok(responses.every(r => r.results.length === 10));
  responses[0].results[0].title = "caller mutation";
  const cached = await f.searchWeb("graph database", { includeContent: false });
  assert.equal(cached.cacheHit, true);
  assert.notEqual(cached.results[0].title, "caller mutation");
  await f.drain();
});

test("content and link-only searches never share an answer-cache entry", async () => {
  const f = fixture();
  const links = await f.searchWeb("graph database", { includeContent: false });
  const content = await f.searchWeb("graph database", { includeContent: true });
  assert.ok(links.results.every(r => r.content === ""));
  assert.equal(content.cacheHit, false);
  assert.ok(content.results.some(r => r.content.startsWith("Full reference")));
  const repeat = await f.searchWeb("graph database", { includeContent: false });
  assert.equal(repeat.cacheHit, true);
  assert.ok(repeat.results.every(r => r.content === ""));
  await f.drain();
});

test("an onion search never reuses the answer cached for the ordinary one", async () => {
  const f = fixture();
  const plain = await f.searchWeb("veri sizintisi", { includeContent: false });
  assert.equal(plain.cacheHit, false);
  // Same words, a different question: one asked the open web, the other also
  // asked a hidden-service index. Sharing an entry would answer the second
  // from a search that never looked.
  const onion = await f.searchWeb("veri sizintisi", { includeContent: false, includeOnion: true });
  assert.equal(onion.cacheHit, false);
  const again = await f.searchWeb("veri sizintisi", { includeContent: false, includeOnion: true });
  assert.equal(again.cacheHit, true);
  await f.drain();
});

test("domain policies isolate cached answers and prevent disallowed prefetches", async () => {
  const f = fixture();
  await f.searchWeb("graph database", { includeContent: false });
  f.stats.pageCalls.length = 0;
  const options = { domainPolicy: { allowedDomains: ["source1.example"] } };
  const restricted = await f.searchWeb("graph database", options);
  assert.equal(restricted.cacheHit, false);
  assert.ok(restricted.results.length > 0);
  assert.ok(restricted.results.every(r => new URL(r.url).hostname === "source1.example"));
  assert.ok(f.stats.pageCalls.every(url => new URL(url).hostname === "source1.example"));
  const blocked = await f.searchWeb("graph database", {
    includeContent: false, domainPolicy: { blockedDomains: ["source1.example"] },
  });
  assert.ok(blocked.results.every(r => new URL(r.url).hostname !== "source1.example"));
  await f.drain();
});

test("request filters are applied before fusion and all speculative work", async () => {
  const f = fixture({ results: (i, query) => Array.from({ length: 20 }, (_, j) => ({
    title: query, snippet: query, url: `https://${j === 9 ? "wanted" : "other"}.example/${i}/${j}`,
  })) });
  const response = await f.searchWeb("graph database", { maxResults: 3, domainFilter: { include: ["wanted.example"] } });
  assert.equal(response.results.length, 3);
  assert.ok(response.results.every(r => new URL(r.url).hostname === "wanted.example"));
  assert.ok(f.stats.pageCalls.every(url => new URL(url).hostname === "wanted.example"));
  await f.drain();
});

test("freshness is strict even when every dated result is too old", async () => {
  const f = fixture({ results: (_, query) => [{ title: query, snippet: query,
    url: "https://old.example/article", publishedAt: "2020-01-01T00:00:00Z" }] });
  const response = await f.searchWeb("graph database", { freshnessHours: 1 });
  assert.deepEqual(response.results, []);
  assert.deepEqual(f.stats.pageCalls, []);
  await f.drain();
});

test("all-slow discovery has a bounded recovery and reports missing sources", async () => {
  const f = fixture({ providerDelays: [850, 900, 950, 1800] });
  const started = performance.now();
  const response = await f.searchWeb("graph database", { includeContent: false, noCache: true });
  assert.ok(performance.now() - started < 1550, "must not wait for the 1800ms source");
  assert.ok(response.results.length > 0);
  assert.ok(response.degraded.some(d => d.provider === "fixture-3" && d.reason === "deadline"));
  await f.drain();
});

test("discovery completion never starts new page fetches from late providers", async () => {
  const f = fixture({ providerDelays: [10, 15, 20, 25, 500] });
  await f.searchWeb("graph database");
  const pageCount = f.stats.pageCalls.length;
  await f.drain();
  assert.equal(f.stats.pageCalls.length, pageCount);
  assert.ok(pageCount <= 5);
});

test("a provider that never settles cannot hold either response or background work", async () => {
  const f = fixture({ providerDelays: [0] });
  f.providers[0].search = () => new Promise(() => {});
  const started = performance.now();
  const response = await f.searchWeb("graph database", { includeContent: false, noCache: true });
  assert.ok(performance.now() - started < 1500);
  assert.deepEqual(response.results, []);
  const degraded = structuredClone(response.degraded);
  await f.drain();
  assert.ok(performance.now() - started < 2900);
  assert.deepEqual(response.degraded, degraded, "late errors cannot mutate a returned answer");
});

test("discarded speculative pages still count toward the five-download cap", async () => {
  const f = fixture({ results: (i, query) => Array.from({ length: 3 }, (_, j) => ({
    title: i === 0 ? "graph notes" : query, snippet: query,
    url: `https://source${i}.example/${j}`,
  })) });
  await f.searchWeb("graph database");
  assert.ok(f.stats.pageCalls.length <= 5);
  await f.drain();
});

test("even non-cooperative page extraction cannot exceed the shared deadline", async () => {
  let aborted = 0;
  const f = fixture({ extract: (_url, { signal }) => {
    signal.addEventListener("abort", () => aborted++, { once: true });
    return new Promise(() => {});
  } });
  const started = performance.now();
  const response = await f.searchWeb("graph database");
  assert.ok(performance.now() - started < 1700);
  assert.ok(response.results.every(r => r.content === r.snippet));
  assert.equal(aborted, f.stats.pageCalls.length);
  await f.drain();
});

test("noCache bypasses both answer and provider cache reads and writes", async () => {
  const f = fixture();
  await f.searchWeb("graph database", { includeContent: false, noCache: true });
  await f.drain();
  assert.equal(f.stats.reads, 0);
  assert.equal(f.stats.writes, 0);
  await f.searchWeb("graph database", { includeContent: false, noCache: true });
  assert.equal(f.stats.providerCalls, 8);
  await f.drain();
});

test("case-sensitive paths and meaningful ref query parameters stay distinct", async () => {
  const urls = ["https://docs.example/API", "https://docs.example/api",
    "https://docs.example/page?ref=one", "https://docs.example/page?ref=two"];
  const f = fixture({ providerDelays: [0], results: (_, query) => urls.map(url => ({ title: query, snippet: query, url })) });
  const response = await f.searchWeb("graph database", { includeContent: false });
  assert.equal(response.results.length, 4);
  await f.drain();
});

test("invalid runtime input yields a stable client error", async () => {
  const f = fixture();
  for (const query of [null, 10, {}, " "]) {
    await assert.rejects(f.searchWeb(query), error => error.code === "invalid_request");
  }
  await assert.rejects(f.searchWeb("graph", { maxResults: NaN }), error => error.code === "invalid_request");
  await assert.rejects(f.searchWeb("graph", { freshnessHours: -1 }), error => error.code === "invalid_request");
  assert.equal(f.stats.providerCalls, 0);
});
