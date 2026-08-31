import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/apiKey";
import { CloudaError, toCloudaError } from "@/lib/core/errors";
import { recordUsage, Operation } from "@/lib/core/metrics";
import { Capability } from "@/lib/constants";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * The gate every v1 route passes through: authenticate the key, check the
 * capability, apply the rate limit, reserve credits, run the handler, then
 * settle credits and write the usage record exactly once.
 */

export interface ApiContext {
  userId: string;
  apiKeyId: string;
  keyName: string;
  credits: number;
  capabilities: string[];
  policy: DomainPolicy;
  rateLimitPerMin: number;
}

export interface HandlerResult {
  /** Response body returned to the caller on success. */
  body: Record<string, unknown>;
  /** Credits actually consumed; may be less than the estimate. */
  creditsUsed: number;
  resultCount?: number;
  provider?: string | null;
  cacheHit?: boolean;
  steps?: number;
  /** Free-text label recorded with the usage row (usually the query). */
  label: string;
}

async function resolveKey(req: NextRequest): Promise<ApiContext> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    throw new CloudaError(
      "missing_api_key",
      "'Authorization: Bearer cld_live_...' başlığı gerekiyor."
    );
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { user: { select: { id: true, credits: true } } },
  });

  if (!apiKey) throw new CloudaError("invalid_api_key", "API anahtarı geçersiz.");
  if (apiKey.revoked) throw new CloudaError("revoked_api_key", "Bu API anahtarı iptal edilmiş.");

  return {
    userId: apiKey.userId,
    apiKeyId: apiKey.id,
    keyName: apiKey.name,
    credits: apiKey.user.credits,
    capabilities: apiKey.capabilities,
    policy: {
      allowedDomains: apiKey.allowedDomains,
      blockedDomains: apiKey.blockedDomains,
    },
    rateLimitPerMin: apiKey.rateLimitPerMin,
  };
}

/**
 * Sliding one-minute window counted from the usage log. Serverless instances
 * share no memory, so the count has to come from the database to be correct
 * across concurrent lambdas.
 */
async function enforceRateLimit(ctx: ApiContext): Promise<void> {
  const since = new Date(Date.now() - 60_000);
  const recent = await prisma.usageLog.count({
    where: { apiKeyId: ctx.apiKeyId, createdAt: { gte: since } },
  });

  if (recent >= ctx.rateLimitPerMin) {
    throw new CloudaError(
      "rate_limited",
      `Dakikada ${ctx.rateLimitPerMin} istek sınırını aştın. Biraz bekleyip tekrar dene.`,
      { limit: ctx.rateLimitPerMin, windowSeconds: 60 }
    );
  }
}

async function enforceBudget(ctx: ApiContext, estimate: number): Promise<void> {
  if (ctx.credits < estimate) {
    throw new CloudaError(
      "insufficient_credits",
      `Bu işlem yaklaşık ${estimate} kredi gerektiriyor, bakiyen ${ctx.credits}.`,
      { required: estimate, available: ctx.credits }
    );
  }

  const key = await prisma.apiKey.findUnique({
    where: { id: ctx.apiKeyId },
    select: { creditCap: true, creditsSpent: true },
  });

  if (key?.creditCap != null && key.creditsSpent + estimate > key.creditCap) {
    throw new CloudaError(
      "credit_cap_reached",
      `Bu anahtar için tanımlı ${key.creditCap} kredilik sınıra ulaşıldı.`,
      { cap: key.creditCap, spent: key.creditsSpent }
    );
  }
}

async function settle(ctx: ApiContext, credits: number): Promise<number> {
  if (credits <= 0) return ctx.credits;

  const [, user] = await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: ctx.apiKeyId },
      data: { lastUsedAt: new Date(), creditsSpent: { increment: credits } },
    }),
    prisma.user.update({
      where: { id: ctx.userId },
      data: { credits: { decrement: credits } },
    }),
  ]);

  return user.credits;
}

export interface RouteOptions {
  operation: Operation;
  /** Capability the key must hold; omit for always-on operations like search. */
  capability?: Capability;
  /** Worst-case credit cost, checked before the handler runs. */
  estimateCredits: number;
}

/**
 * Wraps a route handler with authentication, limits, accounting and a single
 * consistent error envelope.
 */
export function withApi(
  options: RouteOptions,
  handler: (req: NextRequest, ctx: ApiContext) => Promise<HandlerResult>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const started = Date.now();
    let ctx: ApiContext | null = null;

    try {
      ctx = await resolveKey(req);

      if (options.capability && !ctx.capabilities.includes(options.capability)) {
        throw new CloudaError(
          "capability_not_enabled",
          `Bu anahtarda "${options.capability}" özelliği açık değil. Panelden etkinleştirebilirsin.`,
          { capability: options.capability }
        );
      }

      await enforceRateLimit(ctx);
      await enforceBudget(ctx, options.estimateCredits);

      const result = await handler(req, ctx);
      const remaining = await settle(ctx, result.creditsUsed);
      const latencyMs = Date.now() - started;

      await recordUsage({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        operation: options.operation,
        query: result.label,
        resultCount: result.resultCount ?? 0,
        creditsUsed: result.creditsUsed,
        provider: result.provider,
        latencyMs,
        cacheHit: result.cacheHit,
        steps: result.steps,
        success: true,
      });

      return NextResponse.json(
        {
          ...result.body,
          credits_used: result.creditsUsed,
          credits_remaining: remaining,
          took_ms: latencyMs,
        },
        {
          headers: {
            "X-Clouda-Credits-Remaining": String(remaining),
            "X-Clouda-RateLimit-Limit": String(ctx.rateLimitPerMin),
          },
        }
      );
    } catch (err) {
      const error = toCloudaError(err);
      const latencyMs = Date.now() - started;

      if (ctx) {
        await recordUsage({
          userId: ctx.userId,
          apiKeyId: ctx.apiKeyId,
          operation: options.operation,
          query: "-",
          resultCount: 0,
          creditsUsed: 0,
          latencyMs,
          success: false,
          errorCode: error.code,
        });
      }

      return NextResponse.json(error.toJSON(), { status: error.status });
    }
  };
}

/** Parses and validates a JSON body, with a consistent error for bad input. */
export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new CloudaError("invalid_request", "İstek gövdesi geçerli JSON değil.");
  }
}
