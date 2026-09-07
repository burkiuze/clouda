import assert from "node:assert/strict";
import test from "node:test";
import { fixture, projectRoot, delay } from "./helpers/search-fixture.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

test("balanced skips reserve sources after enough primary results; deep queries all", async () => {
  const f = fixture({ providerDelays: Array(8).fill(10) });
  const balanced = await f.searchWeb("graph database", { includeContent: false });
  assert.equal(f.stats.providerCalls, 4);
  assert.equal(balanced.results.length, 10);
  assert.equal(balanced.degraded.length, 0);
  const deep = await f.searchWeb("graph database", { includeContent: false, depth: "deep" });
  assert.equal(deep.cacheHit, false);
  assert.equal(f.stats.providerCalls, 12);
  assert.equal(deep.diagnostics.providersWithResults, 8);
  const cached = await f.searchWeb("graph database", { includeContent: false, depth: "deep" });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.diagnostics.providersQueried, 0);
  assert.equal(cached.diagnostics.pageFetches, 0);
  await f.drain();
});

test("thin primary results trigger the reserve wave", async () => {
  const f = fixture({ providerDelays: Array(8).fill(5), results: (i, query) => i < 4 ? [] : [
    { title: query, snippet: query, url: `https://source${i}.example/article` },
  ] });
  const result = await f.searchWeb("graph database", { includeContent: false, noCache: true });
  assert.equal(f.stats.providerCalls, 8);
  assert.equal(result.results.length, 4);
  await f.drain();
});

test("fast bounds page work and rejects unknown profiles", async () => {
  const f = fixture({ providerDelays: Array(8).fill(5) });
  const result = await f.searchWeb("graph database", { maxResults: 6, depth: "fast", noCache: true });
  assert.equal(f.stats.providerCalls, 3);
  assert.ok(f.stats.pageCalls.length <= 3);
  assert.equal(result.results.length, 6);
  await assert.rejects(f.searchWeb("graph database", { depth: "infinite" }), e => e.code === "invalid_request");
  await f.drain();
});

test("deep includes a useful late source after the balanced deadline", async () => {
  const f = fixture({ providerDelays: [5, 900] });
  const balanced = await f.searchWeb("graph database", { includeContent: false, noCache: true });
  const deep = await f.searchWeb("graph database", { includeContent: false, depth: "deep", noCache: true });
  assert.equal(balanced.results.length, 3);
  assert.equal(deep.results.length, 6);
  await f.drain();
});

test("MCP honors freshness, depth, locale and validated domain filters", async () => {
  let received;
  const { MCP_TOOLS } = loadTs(projectRoot, {
    "@/lib/search/engine": { searchWeb: async (query, options) => {
      received = options;
      return { query, results: [], provider: "none", cacheHit: false };
    } },
    "@/lib/search/newsroom": {},
    "@/lib/data/live": { DATA_KINDS: [], INDICATOR_NAMES: {} },
    "@/lib/crawl/sitemap": {},
  })("lib/mcp/tools.ts");
  const tool = MCP_TOOLS.find(t => t.name === "clouda_search");
  await tool.run({ query: "graph", freshness: 0.5, search_depth: "deep", locale: "en-US",
    include_domains: ["example.org"], exclude_domains: ["old.example.org"] }, { policy: {} });
  assert.equal(received.freshnessHours, 0.5);
  assert.equal(received.depth, "deep");
  assert.equal(received.locale, "en-US");
  assert.deepEqual(received.domainFilter, { include: ["example.org"], exclude: ["old.example.org"] });
  await assert.rejects(tool.run({ query: "graph", include_domains: [42] }, { policy: {} }), e => e.code === "invalid_request");
});

function newsroom(fetcher, initialCache = null) {
  let cached = initialCache;
  const pending = [];
  const module = loadTs(projectRoot, {
    "@/lib/core/http": { safeFetch: fetcher, withFetchSignal: (_, task) => task() },
    "@/lib/core/cache": {
      cacheGet: async () => cached,
      cacheSet: async (_, payload) => { cached = { payload, ageSeconds: 0 }; },
    },
    "@/lib/core/offload": { offload: task => pending.push(task) },
  })("lib/search/newsroom.ts");
  return { ...module, pending };
}

test("concurrent newsroom refreshes share requests and reuse conditional 304 responses", async () => {
  let calls = 0;
  let conditional = 0;
  let failure = false;
  const xml = '<rss><channel><item><title>Graph &#999999999;</title><link>https://news.example/read?id=A&amp;utm_source=feed</link><pubDate>2026-09-06</pubDate></item>' +
    '<item><title>Graph two</title><link>https://news.example/read?id=a</link></item></channel></rss>';
  const f = newsroom(async (_, options) => {
    calls++;
    await delay(5);
    if (failure) return { status: 503, body: "outage" };
    if (options.headers["If-None-Match"] === '"feed-v1"') {
      conditional++;
      return { status: 304, body: "" };
    }
    return { status: 200, body: xml, etag: '"feed-v1"' };
  });
  const counts = await Promise.all(Array.from({ length: 20 }, () => f.refreshNewsCorpus()));
  assert.equal(calls, f.NEWS_SOURCE_COUNT);
  assert.ok(counts.every(count => count === 2));
  assert.equal(await f.refreshNewsCorpus(), 2);
  assert.equal(conditional, f.NEWS_SOURCE_COUNT);
  failure = true;
  assert.equal(await f.refreshNewsCorpus(), 2);
  const articles = await f.newsCorpus();
  assert.deepEqual(articles.map(a => a.url).sort(), ["https://news.example/read?id=A", "https://news.example/read?id=a"]);
  assert.equal(articles[0].publishedAt, "2026-09-06T00:00:00.000Z");
});

test("many stale newsroom reads schedule just one background refresh", async () => {
  const f = newsroom(async () => ({ status: 200, body: "" }), { payload: [{ title: "existing" }], ageSeconds: 200 });
  await Promise.all(Array.from({ length: 20 }, () => f.newsCorpus()));
  assert.equal(f.pending.length, 1);
  await f.pending[0]();
});
