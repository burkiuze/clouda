import { NextRequest, NextResponse } from "next/server";
import { searchWeb } from "@/lib/search/engine";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 200;

async function runDemoSearch(req: NextRequest, query: string | undefined) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";

  if (!rateLimit(`demo:${ip}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Çok fazla deneme arama yaptın, bir dakika sonra tekrar dene." },
      { status: 429 }
    );
  }

  const trimmed = query?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  const result = await searchWeb(trimmed, { maxResults: 3 });

  return NextResponse.json({
    query: result.query,
    results: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content.slice(0, 400),
    })),
    took_ms: result.tookMs,
    source: result.source,
  });
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

// Same demo search over GET, so the endpoint can be tried straight from a
// browser address bar: /api/demo-search?q=...
export async function GET(req: NextRequest) {
  return runDemoSearch(req, req.nextUrl.searchParams.get("q") ?? undefined);
}
