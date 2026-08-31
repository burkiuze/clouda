import { NextRequest, NextResponse } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { prisma } from "@/lib/prisma";
import { assertUrlAllowed } from "@/lib/core/security";
import { hashApiKey } from "@/lib/apiKey";
import { CloudaError, toCloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";

interface MonitorBody {
  type?: string;
  target?: string;
  webhook_url?: string;
  interval_minutes?: number;
}

/**
 * POST /api/v1/monitors — register a watch on a URL or a query.
 * Creating a monitor costs nothing; each scheduled check is billed instead.
 */
export const POST = withApi(
  { operation: "monitor", capability: "monitor", estimateCredits: 0 },
  async (req: NextRequest, ctx) => {
    const body = await readJson<MonitorBody>(req);

    const type = body.type === "query" ? "query" : body.type === "url" ? "url" : null;
    if (!type) {
      throw new CloudaError("invalid_request", "'type' alanı 'url' ya da 'query' olmalı.");
    }

    const target = body.target?.trim();
    if (!target) throw new CloudaError("invalid_request", "'target' alanı gerekli.");

    // A URL watch is an outbound fetch, so it is policy-checked at creation
    // rather than failing silently on the first scheduled run.
    if (type === "url") assertUrlAllowed(target, ctx.policy);
    if (body.webhook_url) assertUrlAllowed(body.webhook_url, ctx.policy);

    const existing = await prisma.monitor.count({ where: { userId: ctx.userId, active: true } });
    if (existing >= 50) {
      throw new CloudaError("invalid_request", "Aktif izleyici sınırına ulaşıldı (50).");
    }

    const monitor = await prisma.monitor.create({
      data: {
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        type,
        target,
        webhookUrl: body.webhook_url ?? null,
        intervalMinutes: parseInt_(body.interval_minutes, 15, 1440, 60),
      },
    });

    return {
      body: {
        monitor_id: monitor.id,
        type: monitor.type,
        target: monitor.target,
        interval_minutes: monitor.intervalMinutes,
        webhook_url: monitor.webhookUrl,
        active: monitor.active,
        created_at: monitor.createdAt.toISOString(),
      },
      creditsUsed: 0,
      resultCount: 1,
      provider: "monitor",
      label: target,
    };
  }
);

/** GET /api/v1/monitors — list this key's monitors and their latest events. */
export async function GET(req: NextRequest) {
  try {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) throw new CloudaError("missing_api_key", "API anahtarı gerekiyor.");

    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
    if (!apiKey || apiKey.revoked) {
      throw new CloudaError("invalid_api_key", "API anahtarı geçersiz.");
    }
    if (!apiKey.capabilities.includes("monitor")) {
      throw new CloudaError(
        "capability_not_enabled",
        'Bu anahtarda "monitor" özelliği açık değil.'
      );
    }

    const monitors = await prisma.monitor.findMany({
      where: { userId: apiKey.userId },
      orderBy: { createdAt: "desc" },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
    });

    return NextResponse.json({
      monitors: monitors.map((m) => ({
        monitor_id: m.id,
        type: m.type,
        target: m.target,
        active: m.active,
        interval_minutes: m.intervalMinutes,
        webhook_url: m.webhookUrl,
        last_checked_at: m.lastCheckedAt?.toISOString() ?? null,
        recent_events: m.events.map((e) => ({
          change_type: e.changeType,
          summary: e.summary,
          delivered: e.delivered,
          occurred_at: e.createdAt.toISOString(),
        })),
      })),
    });
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}
