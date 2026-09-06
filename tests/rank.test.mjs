/**
 * Tests for the pure-computation modules.
 *
 * These are the only parts of the product that can be tested without a network
 * or a database, so they are the only parts that get real tests rather than
 * live measurement. Run with: npm test
 *
 * Both bugs these caught were real: MMR returned a pasta recipe as a "diverse"
 * answer to a question about index bloat, because a document containing none
 * of the query terms has a perfect novelty score.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { rank, tokenize, stem } from "../.test-build/bm25.js";
import { chunkText } from "../.test-build/chunk.js";

test("stemming folds Turkish and English morphology", () => {
  assert.ok(stem("indekslerinden").startsWith("indeks"));
  assert.equal(stem("indexes"), stem("index"));
  assert.equal(stem("running"), stem("run"));
  assert.equal(stem("stopped"), stem("stop"));
  // "address" must not lose its final s, or it stops matching "addresses".
  assert.equal(stem("address"), stem("addresses"));
  assert.equal(stem("status"), "status");
  // -ies has to be restored to -y, not merely cut: "quer" matches nothing.
  assert.equal(stem("queries"), stem("query"));
  assert.equal(stem("libraries"), stem("library"));
  assert.equal(stem("queried"), stem("query"));
});

test("tokenizer drops stopwords and keeps identifiers whole", () => {
  assert.ok(!tokenize("the a ve bir index").includes("the"));
  assert.equal(tokenize("pg_stat_user_indexes").length, 1);
  assert.equal(tokenize("a b index").length, 1);
});

const docs = [
  {
    id: "a",
    title: "Postgres index bloat",
    text: "Index bloat grows when updates leave dead tuples behind. REINDEX CONCURRENTLY rebuilds the index without an exclusive lock.",
  },
  { id: "b", title: "Cooking pasta", text: "Boil water, add salt, cook for nine minutes." },
  {
    id: "c",
    title: "Vacuum and autovacuum",
    text: "Autovacuum reclaims dead tuples. It does not shrink an index; only a rebuild does that.",
  },
  {
    id: "d",
    title: "Postgres index bloat",
    text: "Index bloat grows when updates leave dead tuples behind. REINDEX CONCURRENTLY rebuilds the index without an exclusive lock.",
  },
];

test("BM25 puts the on-topic document first and the off-topic one last", () => {
  const ranked = rank("how do I fix index bloat", docs);
  assert.ok(["a", "d"].includes(ranked[0].id));
  assert.equal(ranked[ranked.length - 1].id, "b");
  assert.equal(ranked[0].relative, 1);
});

test("every result carries its evidence", () => {
  const [top] = rank("index bloat", docs);
  assert.ok(top.matchedTerms.includes("index"));
  assert.ok(top.bestPassage && top.bestPassage.length > 20);
  assert.match(top.bestPassage, /bloat/i);
});

test("MMR trades a duplicate for new material, not for an off-topic document", () => {
  const plain = rank("index bloat dead tuples", docs, { diversity: 0, topK: 2 });
  assert.deepEqual(plain.map((d) => d.id).sort(), ["a", "d"]);

  const diverse = rank("index bloat dead tuples", docs, { diversity: 0.8, topK: 2 });
  assert.ok(diverse.some((d) => d.id === "c"), "should reach for different material");
  assert.ok(!diverse.some((d) => d.id === "b"), "irrelevance is not novelty");
});

test("ranking degrades safely", () => {
  assert.equal(rank("x", []).length, 0);
  assert.equal(rank("zzzz qqqq", docs).length, docs.length);
  assert.equal(rank("index", [{ id: "m", text: "index", metadata: { n: 1 } }])[0].metadata.n, 1);
});

const structured = `# Reindexing

Rebuilding an index removes the bloat that has accumulated in it.

It must be rebuilt concurrently in production, otherwise writes block.

## Autovacuum

Autovacuum reclaims dead tuples in the table. ${"Filler sentence that pads this section out. ".repeat(40)}

## Monitoring

Watch pg_stat_user_indexes for scans that never happen.`;

test("chunks follow the document's own structure", () => {
  const chunks = chunkText(structured, { size: 500, overlap: 60 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.some((c) => c.headings.includes("Autovacuum")));
  assert.ok(chunks.every((c) => c.chars <= 500 + 60 + 120));
  assert.ok(chunks.every((c, i) => c.index === i));
  assert.ok(chunks.every((c, i) => i === 0 || c.start >= chunks[i - 1].start));
});

test("chunking degrades safely", () => {
  assert.equal(chunkText("").length, 0);
  assert.equal(chunkText("Just a sentence.").length, 1);
  assert.ok(chunkText("x".repeat(3000), { size: 500 }).length >= 5);
});
