import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/apiKey";
import { searchWeb } from "@/lib/search/engine";
import { CREDITS_PER_SEARCH } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return NextResponse.json(
      { error: "missing_api_key", message: "Provide 'Authorization: Bearer cld_live_...'" },
      { status: 401 }
    );
  }

  const keyHash = hashApiKey(token);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });

  if (!apiKey || apiKey.revoked) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  }

  let body: { query?: string; max_results?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "missing_query", message: "Body must include a non-empty 'query' string." },
      { status: 400 }
    );
  }

  const maxResults = Math.min(Math.max(Number(body.max_results) || 5, 1), 10);

  if (apiKey.user.credits < CREDITS_PER_SEARCH) {
    return NextResponse.json(
      {
        error: "insufficient_credits",
        message: `This search costs ${CREDITS_PER_SEARCH} credits, but you have ${apiKey.user.credits}.`,
        credits_remaining: apiKey.user.credits,
      },
      { status: 402 }
    );
  }

  const result = await searchWeb(query, { maxResults });

  const [, , updatedUser] = await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }),
    prisma.usageLog.create({
      data: {
        userId: apiKey.userId,
        apiKeyId: apiKey.id,
        query,
        resultCount: result.results.length,
        creditsUsed: CREDITS_PER_SEARCH,
      },
    }),
    prisma.user.update({
      where: { id: apiKey.userId },
      data: { credits: { decrement: CREDITS_PER_SEARCH } },
    }),
  ]);

  return NextResponse.json({
    query: result.query,
    results: result.results,
    took_ms: result.tookMs,
    credits_used: CREDITS_PER_SEARCH,
    credits_remaining: updatedUser.credits,
  });
}
