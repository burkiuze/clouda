import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkMonitor, dueMonitors } from "@/lib/monitor/watcher";
import { cacheInvalidate } from "@/lib/core/cache";
import { CREDITS } from "@/lib/constants";
import { recordUsage } from "@/lib/core/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled monitor sweep. Vercel Cron calls this; the CRON_SECRET check keeps
 * anyone else from triggering paid work. Each check bills the owning account,
 * and a monitor whose owner has run out of credits is paused rather than
 * failing repeatedly.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const monitors = await dueMonitors(15);
  const outcomes: { monitor_id: string; change_type: string; summary: string }[] = [];

  for (const monitor of monitors) {
    const row = await prisma.monitor.findUnique({
      where: { id: monitor.id },
      select: { userId: true, apiKeyId: true, user: { select: { credits: true } } },
    });
    if (!row) continue;

    if (row.user.credits < CREDITS.monitorCheck) {
      await prisma.monitor.update({ where: { id: monitor.id }, data: { active: false } });
      outcomes.push({
        monitor_id: monitor.id,
        change_type: "paused",
        summary: "Kredi yetersiz, izleyici durduruldu.",
      });
      continue;
    }

    const checkStarted = Date.now();
    try {
      const outcome = await checkMonitor(monitor);

      await prisma.user.update({
        where: { id: row.userId },
        data: { credits: { decrement: CREDITS.monitorCheck } },
      });
      await recordUsage({
        userId: row.userId,
        apiKeyId: row.apiKeyId,
        operation: "monitor",
        query: monitor.target,
        resultCount: outcome.changed ? 1 : 0,
        creditsUsed: CREDITS.monitorCheck,
        provider: "monitor",
        latencyMs: Date.now() - checkStarted,
        success: outcome.changeType !== "unreachable",
        errorCode: outcome.changeType === "unreachable" ? "fetch_failed" : null,
      });

      outcomes.push({
        monitor_id: monitor.id,
        change_type: outcome.changeType,
        summary: outcome.summary,
      });
    } catch (err) {
      outcomes.push({
        monitor_id: monitor.id,
        change_type: "error",
        summary: err instanceof Error ? err.message.slice(0, 200) : "bilinmeyen hata",
      });
    }
  }

  // Piggyback cache housekeeping on the same sweep.
  const purged = await cacheInvalidate();

  return NextResponse.json({
    checked: monitors.length,
    outcomes,
    cache_rows_purged: purged,
    took_ms: Date.now() - started,
  });
}
