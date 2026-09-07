import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { loadTs } from "./helpers/load-ts.mjs";
import { projectRoot, delay } from "./helpers/search-fixture.mjs";

function http() { return loadTs(projectRoot)("lib/core/http.ts"); }

test("one HTTP deadline covers redirects, not a fresh timeout for each hop", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    await delay(80, undefined, { signal });
    return new Response(null, { status: 302, headers: { location: "/next" } });
  });
  const started = performance.now();
  await assert.rejects(http().safeFetch("https://example.com/start", { timeoutMs: 120 }),
    error => error.code === "fetch_timeout");
  // Module loading is excluded from production latency, so allow room here.
  assert.ok(performance.now() - started < 450);
});

test("a stalled streaming body is a typed timeout and is cancelled", async (t) => {
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => {
        aborted = true;
        controller.error(signal.reason);
      }, { once: true });
    },
  })));
  await assert.rejects(http().safeFetch("https://example.com", { timeoutMs: 30 }),
    error => error.code === "fetch_timeout");
  assert.equal(aborted, true);
});

test("the body cap preserves a prefix even when the first chunk exceeds it", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("abcdefghijklmnopqrstuvwxyz"));
  const result = await http().safeFetch("https://example.com", { maxBytes: 10 });
  assert.equal(result.bytes, 10);
  assert.equal(result.body, "abcdefghij");
});

test("trusted provider redirects still cannot reach private literal addresses", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  });
  await assert.rejects(http().safeFetch("https://example.com", { trusted: true }),
    error => error.code === "blocked_url");
  assert.equal(calls, 1);
});

test("redirects release their body and remove credentials when origins differ", async (t) => {
  const headers = [];
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    headers.push(new Headers(init.headers));
    if (headers.length === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 302, headers: { location: "https://other.example/target" },
    });
    return new Response("ok");
  });
  const result = await http().safeFetch("https://example.com", {
    headers: new Headers({ authorization: "Bearer fixture", cookie: "fixture=1", accept: "text/plain" }),
  });
  assert.equal(cancelled, true);
  assert.equal(headers[0].get("authorization"), "Bearer fixture");
  assert.equal(headers[1].has("authorization"), false);
  assert.equal(headers[1].has("cookie"), false);
  assert.equal(headers[1].get("accept"), "text/plain");
  assert.equal(result.chain.length, 2);
});

test("a provider scope abort cancels its nested HTTP requests", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    await delay(1000, undefined, { signal });
    return new Response("late");
  });
  const { safeFetch, withFetchSignal } = http();
  const controller = new AbortController();
  const work = withFetchSignal(controller.signal, () => safeFetch("https://example.com"));
  controller.abort();
  await assert.rejects(work, error => error.code === "fetch_timeout");
});

test("URL policy blocks canonical mapped IPv6 and trailing-dot loopback names", () => {
  const { assertUrlAllowed } = loadTs(projectRoot)("lib/core/security.ts");
  for (const url of ["http://[::ffff:127.0.0.1]", "http://[::ffff:7f00:1]", "http://localhost.",
    "http://[fe90::1]", "http://[ff02::1]", "http://2130706433"]) {
    assert.throws(() => assertUrlAllowed(url), error => error.code === "blocked_url");
  }
  assert.equal(assertUrlAllowed("https://example.com.").hostname, "example.com");
});

test("error HTML is not returned as extracted source material", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<article><p>Access denied.</p></article>", {
    status: 500, headers: { "content-type": "text/html" },
  }));
  const { fetchAndExtract } = loadTs(projectRoot)("lib/search/extract.ts");
  assert.equal(await fetchAndExtract("https://example.com"), null);
});
