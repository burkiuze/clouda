import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { projectRoot, fixture } from "./helpers/search-fixture.mjs";

function providers(fetcher) {
  return loadTs(projectRoot, {
    "@/lib/core/http": { safeFetch: fetcher },
    "@/lib/search/newsroom": { asRawResults: x => x, matchNews: x => x, newsCorpus: async () => [] },
  })("lib/search/providers.ts");
}

test("Marginalia uses the current API with a bounded server budget", async () => {
  let request;
  const { ALL_PROVIDERS, searchProvider } = providers(async (url, options) => {
    request = { url: new URL(url), options };
    return { status: 200, body: '{"results":[]}' };
  });
  await searchProvider(ALL_PROVIDERS.find(p => p.name === "marginalia"), "graph & database", 10, "en");
  assert.equal(request.url.origin, "https://api2.marginalia-search.com");
  assert.equal(request.url.searchParams.get("query"), "graph & database");
  assert.equal(request.url.searchParams.get("timeout"), "250");
  assert.ok(request.options.headers["API-Key"]);
});

test("SearXNG is opt-in and forwards query, locale and time range", async () => {
  const prior = process.env.SEARXNG_BASE_URL;
  try {
    delete process.env.SEARXNG_BASE_URL;
    let request;
    const { ALL_PROVIDERS, openProvidersForIntent, searchProvider } = providers(async url => {
      request = new URL(url);
      return { status: 200, body: '{"results":[{"title":"Graph","url":"https://reference.example/graph","content":"Database"}]}' };
    });
    const source = ALL_PROVIDERS.find(p => p.name === "searxng");
    assert.equal(source.available(), false);
    process.env.SEARXNG_BASE_URL = "http://127.0.0.1:8080";
    assert.equal(source.available(), false);
    process.env.SEARXNG_BASE_URL = "https://search.example/";
    assert.ok(openProvidersForIntent("general").includes(source));
    const result = await searchProvider(source, "graph & database", 5, "tr-TR", 12);
    assert.equal(request.pathname, "/search");
    assert.equal(request.searchParams.get("q"), "graph & database");
    assert.equal(request.searchParams.get("language"), "tr-TR");
    assert.equal(request.searchParams.get("time_range"), "day");
    assert.equal(request.searchParams.get("safesearch"), "2");
    assert.equal(result.length, 1);
  } finally {
    if (prior == null) delete process.env.SEARXNG_BASE_URL;
    else process.env.SEARXNG_BASE_URL = prior;
  }
});

test("a provider HTTP failure is not misreported as a successful empty search", async () => {
  const { ALL_PROVIDERS, searchProvider } = providers(async () => ({ status: 503, body: "outage" }));
  const marginalia = ALL_PROVIDERS.find(p => p.name === "marginalia");
  await assert.rejects(searchProvider(marginalia, "graph", 10, "en"), error => error.code === "provider_failed");
});

test("a valid empty provider response remains successful", async () => {
  const { ALL_PROVIDERS, searchProvider } = providers(async () => ({ status: 200, body: '{"results":[]}' }));
  assert.deepEqual(await searchProvider(ALL_PROVIDERS.find(p => p.name === "marginalia"), "graph", 10, "en"), []);
});

test("one failed endpoint does not discard a composite provider's useful result", async () => {
  const { ALL_PROVIDERS, searchProvider } = providers(async (url) => url.includes("tr.wikipedia") ?
    { status: 503, body: "outage" } : { status: 200, body: '{"query":{"search":[{"title":"Graph","snippet":"graph data"}]}}' });
  const response = await searchProvider(ALL_PROVIDERS.find(p => p.name === "wikipedia"), "graph", 10, "tr-TR");
  assert.equal(response.length, 1);
  assert.equal(new URL(response[0].url).hostname, "en.wikipedia.org");
});

test("repeated provider failures open the circuit; empty results do not", async () => {
  const f = fixture({ providerDelays: [0] });
  let calls = 0;
  f.providers[0].search = async () => { calls++; throw new Error("upstream outage"); };
  for (let i = 0; i < 4; i++) await f.searchWeb("graph database", { noCache: true });
  const last = await f.searchWeb("graph database", { noCache: true });
  assert.equal(calls, 4);
  assert.match(last.degraded[0].reason, /circuit_open/);
  const empty = fixture({ providerDelays: [0], results: () => [] });
  for (let i = 0; i < 5; i++) await empty.searchWeb("graph database", { noCache: true });
  assert.equal(empty.stats.providerCalls, 5);
  await f.drain();
  await empty.drain();
});
