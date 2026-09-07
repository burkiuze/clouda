import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fixture, delay, projectRoot } from "../tests/helpers/search-fixture.mjs";

// Deterministic I/O delays around the real search/cache code. These are local
// regression benchmarks, not production latency or search-quality claims.
const root = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
const samples = 5;
const report = [];
async function measure(name, setup, run) {
  const timings = [], calls = [], counts = [];
  for (let i = 0; i < samples; i++) {
    const f = await setup();
    const before = f.stats.providerCalls;
    const start = performance.now();
    const responses = [await run(f)].flat();
    timings.push(performance.now() - start);
    calls.push(f.stats.providerCalls - before);
    counts.push(responses.reduce((sum, response) => sum + response.results.length, 0));
    await f.drain();
  }
  timings.sort((a, b) => a - b);
  report.push({ scenario: name, p50_ms: +timings[2].toFixed(1), p95_ms: +timings[4].toFixed(1),
    provider_calls: calls, result_counts: counts });
}

await measure("healthy_uncached", () => fixture({ root }), f =>
  f.searchWeb("graph database", { includeContent: false, noCache: true }));
await measure("freshness_cache_repeat", async () => {
  const f = fixture({ root, dbReadMs: 60 });
  await f.searchWeb("graph database", { includeContent: false, freshnessHours: 1 });
  await f.drain();
  return f;
}, f => f.searchWeb("graph database", { includeContent: false, freshnessHours: 1 }));
await measure("ten_identical_concurrent", () => fixture({ root }), f =>
  Promise.all(Array.from({ length: 10 }, () => f.searchWeb("graph database", { includeContent: false }))));
await measure("all_sources_slow", () => fixture({ root, providerDelays: [900, 1000, 1100, 2400] }), f =>
  f.searchWeb("graph database", { includeContent: false, noCache: true }));
await measure("slow_cache_read", () => fixture({ root, dbReadMs: 300 }), f =>
  f.searchWeb("graph database", { includeContent: false }));
console.log(JSON.stringify({ kind: "local controlled-I/O benchmark", samples, report }, null, 2));
// Let provider calls retained for cache warming finish before process teardown.
await delay(2500);
