import { NextRequest, NextResponse } from "next/server";
import { refreshNewsCorpus, NEWS_SOURCE_COUNT } from "@/lib/search/newsroom";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps the news corpus warm.
 *
 * Without this the first news query after a quiet spell pays for pulling
 * twenty-two feeds. With it, that cost is moved to a schedule nobody is
 * waiting on and the query reads a corpus that is already there.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const articles = await refreshNewsCorpus();

  return NextResponse.json({
    feeds: NEWS_SOURCE_COUNT,
    articles,
    took_ms: Date.now() - started,
  });
}
