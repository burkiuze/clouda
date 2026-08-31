import { NextRequest, NextResponse } from "next/server";
import { searchWeb } from "@/lib/search/engine";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";

  if (!rateLimit(`demo:${ip}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many demo searches, try again in a minute." },
      { status: 429 }
    );
  }

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }
  if (query.length > 200) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  const result = await searchWeb(query, { maxResults: 3 });

  return NextResponse.json({
    query: result.query,
    results: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content.slice(0, 400),
    })),
    took_ms: result.tookMs,
  });
}
