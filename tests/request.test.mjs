import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/search-fixture.mjs";

test("API JSON parsing rejects scalar, null and array bodies with a client error", async () => {
  const { readJson } = fixture().load("lib/api/gateway.ts");
  for (const value of [null, [], "query", 42, true]) {
    await assert.rejects(readJson({ json: async () => value }), error => error.code === "invalid_request");
  }
  assert.deepEqual(await readJson({ json: async () => ({ query: "graph" }) }), { query: "graph" });
});
