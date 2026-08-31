import { NextRequest, NextResponse } from "next/server";
import { searchWeb } from "@/lib/search/engine";
import { consume, LIMITS } from "@/lib/core/limits";
import { requestActor } from "@/lib/core/request";
import { recordSecurityEvent } from "@/lib/core/audit";
import { toCloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUERY_LENGTH = 200;

/** Public demo behind the landing page. No key, no credits, tight limits. */
async function runDemoSearch(req: NextRequest, query: string | undefined) {
  // A demo search fans out to several providers and fetches pages, so it is
  // the most expensive unauthenticated thing on the site. The counter is
  // shared across instances; the old per-process one reset on every cold start.
  const actor = requestActor(req);
  const verdict = await consume(LIMITS.demoSearch, actor);
  if (!verdict.allowed) {
    await recordSecurityEvent({ kind: "demo_throttled", actorHash: actor });
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Çok fazla deneme arama yaptın, birazdan tekrar dene.",
      },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfter) } }
    );
  }

  const trimmed = query?.trim();
  if (!trimmed) return NextResponse.json({ error: "missing_query" }, { status: 400 });
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  try {
    const result = await searchWeb(trimmed, { maxResults: 6 });

    return NextResponse.json({
      query: result.query,
      intent: result.plan.intent,
      results: result.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        content: r.content.slice(0, 400),
        published_at: r.publishedAt,
        scores: r.scores,
      })),
      took_ms: result.tookMs,
      source: result.provider,
      cached: result.cacheHit,
      // Which sources declined to answer, so a thin result set can be
      // explained rather than guessed at.
      degraded: result.degraded,
    });
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}

export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }
  return runDemoSearch(req, body.query);
}

// Same demo search over GET, so the endpoint can be tried from a browser.
export async function GET(req: NextRequest) {
  return runDemoSearch(req, req.nextUrl.searchParams.get("q") ?? undefined);
}
