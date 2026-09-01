import { NextRequest, NextResponse } from "next/server";
import { fetchAndExtract } from "@/lib/search/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * TEMPORARY. How long page extraction actually needs, and how often it
 * succeeds, measured against real result URLs from this deployment's egress.
 *
 * A live search spent its whole 1.2s extraction budget and returned every
 * result on its snippet — so either the pages are slow, or they extract to
 * nothing. This tells the two apart instead of guessing.
 */
const TOKEN = "probe_9f4c1a7e2b";

const URLS = [
  "https://stackoverflow.com/q/46035602",
  "https://serverfault.com/q/371053",
  "https://supabase.com/blog/postgres-bloat",
  "https://www.cybertec-postgresql.com/en/index-bloat-reduced-in-postgresql-v14/",
  "https://curatedsql.com/2025/12/03/dealing-with-index-bloat-in-postgres/",
  "https://en.wikipedia.org/wiki/Database_index",
  "https://www.bbc.co.uk/news/articles/c99dym3prl1o",
  "https://www.aa.com.tr/tr/ekonomi/avro-bolgesinde-imalat-sanayi-pmi-agustosta-527ye-yukseldi/3745000",
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const timeoutMs = Number(req.nextUrl.searchParams.get("timeout") ?? 6000);

  const results = await Promise.all(
    URLS.map(async (url) => {
      const started = Date.now();
      try {
        const page = await fetchAndExtract(url, { timeoutMs });
        return {
          url: url.slice(0, 60),
          ms: Date.now() - started,
          chars: page?.content?.length ?? 0,
          published: page?.publishedAt ?? null,
        };
      } catch (err) {
        return {
          url: url.slice(0, 60),
          ms: Date.now() - started,
          chars: 0,
          error: err instanceof Error ? err.message.slice(0, 80) : "unknown",
        };
      }
    })
  );

  const ok = results.filter((r) => r.chars > 200);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);

  return NextResponse.json({
    timeout_ms: timeoutMs,
    extracted: ok.length,
    total: results.length,
    p50_ms: times[Math.floor(times.length / 2)] ?? null,
    slowest_ok_ms: times[times.length - 1] ?? null,
    results: results.sort((a, b) => a.ms - b.ms),
  });
}
