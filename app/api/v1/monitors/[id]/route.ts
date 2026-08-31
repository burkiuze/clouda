import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/apiKey";
import { CloudaError, toCloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";

async function requireKey(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new CloudaError("missing_api_key", "API anahtarı gerekiyor.");

  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
  if (!apiKey || apiKey.revoked) throw new CloudaError("invalid_api_key", "API anahtarı geçersiz.");
  return apiKey;
}

/** DELETE /api/v1/monitors/{id} — stop watching. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await requireKey(req);
    const { id } = await params;

    const monitor = await prisma.monitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== apiKey.userId) {
      throw new CloudaError("not_found", "İzleyici bulunamadı.");
    }

    await prisma.monitor.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ monitor_id: id, active: false });
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}

/** GET /api/v1/monitors/{id} — full event history for one monitor. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await requireKey(req);
    const { id } = await params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    if (!monitor || monitor.userId !== apiKey.userId) {
      throw new CloudaError("not_found", "İzleyici bulunamadı.");
    }

    return NextResponse.json({
      monitor_id: monitor.id,
      type: monitor.type,
      target: monitor.target,
      active: monitor.active,
      interval_minutes: monitor.intervalMinutes,
      last_checked_at: monitor.lastCheckedAt?.toISOString() ?? null,
      events: monitor.events.map((e) => ({
        change_type: e.changeType,
        summary: e.summary,
        payload: e.payload,
        delivered: e.delivered,
        occurred_at: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}
