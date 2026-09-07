import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { projectRoot, delay } from "./helpers/search-fixture.mjs";

test("a rejected shared operation is removed so the next request can recover", async () => {
  const { SingleFlight } = loadTs(projectRoot)("lib/core/async.ts");
  const flights = new SingleFlight();
  let calls = 0;
  const fail = () => { calls++; return Promise.reject(new Error("outage")); };
  await Promise.allSettled(Array.from({ length: 10 }, () => flights.run("query", fail)));
  assert.equal(calls, 1);
  assert.equal(await flights.run("query", async () => "recovered"), "recovered");
});

test("deadline expiry observes a late rejection without leaking it", async () => {
  const { within } = loadTs(projectRoot)("lib/core/async.ts");
  const late = delay(20).then(() => { throw new Error("late failure"); });
  assert.equal(await within(late, 1), null);
  await delay(30);
});
