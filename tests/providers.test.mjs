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

const ONION_A = `${"a".repeat(56)}.onion`;
const ONION_B = `${"c".repeat(56)}.onion`;

const AHMIA_HTML = `<ol id="ahmia-results">
  <li class="result">
    <h4><a href="/search/redirect?search_term=x&redirect_url=http%3A%2F%2F${"a".repeat(56)}.onion%2Fwiki">Hidden Wiki</a></h4>
    <cite>${"a".repeat(56)}.onion/wiki</cite>
    <p>Onion <b>servis</b> dizini.</p>
  </li>
  <li class="result">
    <h4><a href="/search/redirect?redirect_url=https%3A%2F%2Fclearnet.example%2Fpage">Clearnet sonucu</a></h4>
    <cite>clearnet.example/page</cite><p>Onion degil.</p>
  </li>
  <li class="result">
    <h4><a href="/search/redirect?redirect_url=http%3A%2F%2F${"b".repeat(16)}.onion%2F">Eski v2</a></h4>
    <cite>${"b".repeat(16)}.onion</cite><p>Artik cozulmuyor.</p>
  </li>
  <li class="result">
    <h4><a href="http://${"c".repeat(56)}.onion/forum">Forum</a></h4>
    <cite>${"c".repeat(56)}.onion/forum</cite><p>Ikinci onion.</p>
  </li>
</ol>`;

test("Ahmia is off unless the operator enables onion search", async () => {
  const priorProxy = process.env.TOR_SOCKS_PROXY;
  const priorFlag = process.env.CLOUDA_ONION_SEARCH;
  try {
    delete process.env.TOR_SOCKS_PROXY;
    delete process.env.CLOUDA_ONION_SEARCH;
    const { ALL_PROVIDERS, openProvidersForIntent } = providers(async () => ({ status: 200, body: "" }));
    const source = ALL_PROVIDERS.find(p => p.name === "ahmia");
    assert.equal(source.available(), false);
    // Even asked for explicitly, a deployment that has not enabled it gets nothing.
    assert.equal(openProvidersForIntent("general", { includeOnion: true }).includes(source), false);

    process.env.TOR_SOCKS_PROXY = "127.0.0.1:9050";
    assert.equal(source.available(), true);
    // Enabled is not the same as asked for: onion never joins a default set.
    assert.equal(openProvidersForIntent("general").includes(source), false);
    assert.equal(openProvidersForIntent("news").includes(source), false);
    assert.equal(openProvidersForIntent("general", { includeOnion: true }).includes(source), true);

    // The operator's own switch overrides in both directions.
    process.env.CLOUDA_ONION_SEARCH = "0";
    assert.equal(source.available(), false);
    delete process.env.TOR_SOCKS_PROXY;
    process.env.CLOUDA_ONION_SEARCH = "1";
    assert.equal(source.available(), true, "onion links are listable without running Tor");
  } finally {
    if (priorProxy == null) delete process.env.TOR_SOCKS_PROXY; else process.env.TOR_SOCKS_PROXY = priorProxy;
    if (priorFlag == null) delete process.env.CLOUDA_ONION_SEARCH; else process.env.CLOUDA_ONION_SEARCH = priorFlag;
  }
});

test("Ahmia results keep only resolvable v3 onion addresses", async () => {
  const prior = process.env.CLOUDA_ONION_SEARCH;
  try {
    process.env.CLOUDA_ONION_SEARCH = "1";
    let request;
    const { ALL_PROVIDERS, searchProvider } = providers(async (url) => {
      request = new URL(url);
      return { status: 200, body: AHMIA_HTML };
    });
    const results = await searchProvider(ALL_PROVIDERS.find(p => p.name === "ahmia"), "leak & dump", 10, "tr-TR");
    assert.equal(request.origin, "https://ahmia.fi");
    assert.equal(request.searchParams.get("q"), "leak & dump");
    // The clearnet row and the retired v2 address are both dropped: one is not
    // what this source is for, the other cannot be reached at all.
    assert.deepEqual(results.map(r => new URL(r.url).hostname), [ONION_A, ONION_B]);
    assert.equal(results[0].title, "Hidden Wiki");
    assert.equal(results[0].snippet, "Onion servis dizini.");
  } finally {
    if (prior == null) delete process.env.CLOUDA_ONION_SEARCH; else process.env.CLOUDA_ONION_SEARCH = prior;
  }
});

test("a markup change falls back to any onion address on the page", async () => {
  const prior = process.env.CLOUDA_ONION_SEARCH;
  try {
    process.env.CLOUDA_ONION_SEARCH = "1";
    const { ALL_PROVIDERS, searchProvider } = providers(async () => ({
      status: 200,
      body: `<div><a href="http://${"a".repeat(56)}.onion/x">Yeni sablon</a><a href="/about">Hakkinda</a></div>`,
    }));
    const results = await searchProvider(ALL_PROVIDERS.find(p => p.name === "ahmia"), "x", 5, "tr-TR");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Yeni sablon");
  } finally {
    if (prior == null) delete process.env.CLOUDA_ONION_SEARCH; else process.env.CLOUDA_ONION_SEARCH = prior;
  }
});
