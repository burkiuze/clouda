import { NextRequest, NextResponse } from "next/server";
import { FEEDS, matchNews, newsCorpus } from "@/lib/search/newsroom";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * TEMPORARY. Runs the real newsroom module against the real feeds so the
 * parser, the timestamps and the matcher can be checked on live data rather
 * than on a fixture guessed from their shape.
 */
const TOKEN = "probe_9f4c1a7e2b";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const started = Date.now();
  const corpus = await newsCorpus();
  const loadMs = Date.now() - started;

  const perFeed: Record<string, { items: number; dated: number }> = {};
  for (const feed of FEEDS) perFeed[feed.name] = { items: 0, dated: 0 };
  for (const item of corpus) {
    const stat = perFeed[item.source];
    if (!stat) continue;
    stat.items += 1;
    if (item.publishedAt) stat.dated += 1;
  }

  const queries = (req.nextUrl.searchParams.get("q") ?? "ekonomi|artificial intelligence|deprem")
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);

  const matched = queries.map((q) => {
    const at = Date.now();
    const hits = matchNews(corpus, q, 5);
    return {
      query: q,
      ms: Date.now() - at,
      hits: hits.length,
      sample: hits.slice(0, 3).map((h) => `${h.publishedAt ?? "?"} | ${h.source} | ${h.title}`),
    };
  });

  return NextResponse.json({
    corpus_size: corpus.length,
    load_ms: loadMs,
    dated: corpus.filter((c) => c.publishedAt).length,
    empty_feeds: Object.entries(perFeed)
      .filter(([, v]) => v.items === 0)
      .map(([k]) => k),
    per_feed: perFeed,
    newest: corpus.slice(0, 3).map((c) => `${c.publishedAt} | ${c.source} | ${c.title}`),
    matched,
  });
}
