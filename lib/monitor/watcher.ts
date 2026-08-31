import { createHash, createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { safeFetch } from "@/lib/core/http";
import { parsePage } from "@/lib/search/extract";
import { searchWeb } from "@/lib/search/engine";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * Web monitoring.
 *
 * Two kinds of watch: a URL, where the readable content of a page is
 * fingerprinted and compared; and a query, where the set of result URLs is
 * compared so new coverage shows up as an event. Both write a MonitorEvent
 * and, when a webhook is configured, deliver it.
 *
 * Change detection runs on extracted text rather than raw HTML — otherwise a
 * rotating ad slot or a CSRF token reads as "the page changed".
 */

export interface CheckOutcome {
  changed: boolean;
  changeType: "content_changed" | "new_results" | "unreachable" | "unchanged";
  summary: string;
  payload?: Record<string, unknown>;
}

function fingerprint(text: string): string {
  // Numbers are kept: a price change is exactly what a watcher wants to catch.
  const normalised = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalised).digest("hex");
}

/** A short, human-readable description of what moved. */
function describeTextDiff(before: string, after: string): string {
  const beforeLines = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
  const afterLines = after.split("\n").map((l) => l.trim()).filter(Boolean);

  const added = afterLines.filter((l) => !beforeLines.has(l));
  if (added.length === 0) return "İçerik değişti (metin çıkarıldı).";

  const sample = added[0].slice(0, 180);
  return added.length === 1
    ? `Yeni içerik: "${sample}"`
    : `${added.length} yeni satır, ilki: "${sample}"`;
}

/** Numbers that look like prices, so a price watch can say what it saw. */
function extractPrices(text: string): string[] {
  const matches = text.match(/(?:₺|TL|\$|€|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:₺|TL|USD|EUR|GBP)/gi);
  return Array.from(new Set(matches ?? [])).slice(0, 5);
}

async function checkUrlMonitor(
  target: string,
  lastHash: string | null,
  lastSnapshot: string | null,
  policy?: DomainPolicy
): Promise<CheckOutcome> {
  let content: string;
  let title: string;

  try {
    const res = await safeFetch(target, { policy, timeoutMs: 10_000 });
    const page = parsePage(res);
    content = page.content;
    title = page.title;
  } catch (err) {
    return {
      changed: false,
      changeType: "unreachable",
      summary: err instanceof Error ? err.message.slice(0, 200) : "Sayfaya ulaşılamadı.",
    };
  }

  const hash = fingerprint(content);
  if (!lastHash) {
    return {
      changed: false,
      changeType: "unchanged",
      summary: "İlk anlık görüntü alındı.",
      payload: { hash, snapshot: content, title },
    };
  }
  if (hash === lastHash) {
    return { changed: false, changeType: "unchanged", summary: "Değişiklik yok.", payload: { hash } };
  }

  const prices = extractPrices(content);
  const previousPrices = lastSnapshot ? extractPrices(lastSnapshot) : [];
  const priceChanged =
    prices.length > 0 && previousPrices.length > 0 && prices.join("|") !== previousPrices.join("|");

  return {
    changed: true,
    changeType: "content_changed",
    summary: priceChanged
      ? `Fiyat değişti: ${previousPrices.join(", ")} → ${prices.join(", ")}`
      : describeTextDiff(lastSnapshot ?? "", content),
    payload: {
      hash,
      snapshot: content,
      title,
      url: target,
      ...(priceChanged ? { previousPrices, currentPrices: prices } : {}),
    },
  };
}

async function checkQueryMonitor(
  query: string,
  lastSnapshot: string | null,
  policy?: DomainPolicy
): Promise<CheckOutcome> {
  const res = await searchWeb(query, {
    maxResults: 8,
    includeContent: false,
    noCache: true,
    domainPolicy: policy,
    freshnessHours: 24 * 7,
  });

  const urls = res.results.map((r) => r.url);
  const hash = fingerprint(urls.join("\n"));

  const known = new Set((lastSnapshot ?? "").split("\n").filter(Boolean));
  if (known.size === 0) {
    return {
      changed: false,
      changeType: "unchanged",
      summary: `İlk anlık görüntü: ${urls.length} sonuç.`,
      payload: { hash, snapshot: urls.join("\n") },
    };
  }

  const fresh = res.results.filter((r) => !known.has(r.url));
  if (fresh.length === 0) {
    return { changed: false, changeType: "unchanged", summary: "Yeni sonuç yok.", payload: { hash } };
  }

  return {
    changed: true,
    changeType: "new_results",
    summary: `${fresh.length} yeni sonuç: ${fresh[0].title}`,
    payload: {
      hash,
      snapshot: Array.from(new Set([...urls, ...known])).slice(0, 50).join("\n"),
      newResults: fresh.map((r) => ({
        title: r.title,
        url: r.url,
        publishedAt: r.publishedAt,
        credibility: r.scores.credibility,
      })),
    },
  };
}

async function deliverWebhook(
  webhookUrl: string,
  body: Record<string, unknown>,
  secret?: string | null
): Promise<boolean> {
  try {
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "CloudaWebhook/1.0",
    };

    // An unsigned callback is an unauthenticated POST: anyone who learns the
    // URL can forge change notifications into the receiver. The timestamp is
    // inside the signed string so a captured body cannot be replayed later.
    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      headers["X-Clouda-Timestamp"] = timestamp;
      headers["X-Clouda-Signature"] = `v1=${signature}`;
    }

    // Webhook targets are caller-supplied, so they go through the same
    // SSRF policy as any other outbound request.
    const res = await safeFetch(webhookUrl, {
      method: "POST",
      timeoutMs: 8000,
      headers,
      body: payload,
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

export interface MonitorRecord {
  id: string;
  type: string;
  target: string;
  webhookUrl: string | null;
  lastHash: string | null;
  lastSnapshot: string | null;
  apiKey: { allowedDomains: string[]; blockedDomains: string[]; webhookSecret?: string | null };
}

/** Runs one monitor and persists whatever it found. */
export async function checkMonitor(monitor: MonitorRecord): Promise<CheckOutcome> {
  const policy: DomainPolicy = {
    allowedDomains: monitor.apiKey.allowedDomains,
    blockedDomains: monitor.apiKey.blockedDomains,
  };

  const outcome =
    monitor.type === "query"
      ? await checkQueryMonitor(monitor.target, monitor.lastSnapshot, policy)
      : await checkUrlMonitor(monitor.target, monitor.lastHash, monitor.lastSnapshot, policy);

  const payload = outcome.payload ?? {};
  await prisma.monitor.update({
    where: { id: monitor.id },
    data: {
      lastCheckedAt: new Date(),
      ...(typeof payload.hash === "string" ? { lastHash: payload.hash } : {}),
      ...(typeof payload.snapshot === "string"
        ? { lastSnapshot: (payload.snapshot as string).slice(0, 20_000) }
        : {}),
    },
  });

  if (outcome.changeType === "unchanged") return outcome;

  // Snapshots are large and already stored on the monitor row.
  const eventPayload = { ...payload };
  delete eventPayload.snapshot;

  const event = await prisma.monitorEvent.create({
    data: {
      monitorId: monitor.id,
      changeType: outcome.changeType,
      summary: outcome.summary,
      payload: eventPayload as never,
    },
  });

  if (outcome.changed && monitor.webhookUrl) {
    const delivered = await deliverWebhook(monitor.webhookUrl, {
      event: "monitor.changed",
      monitor_id: monitor.id,
      change_type: outcome.changeType,
      summary: outcome.summary,
      target: monitor.target,
      occurred_at: event.createdAt.toISOString(),
      data: eventPayload,
    }, monitor.apiKey.webhookSecret);
    if (delivered) {
      await prisma.monitorEvent.update({ where: { id: event.id }, data: { delivered: true } });
    }
  }

  return outcome;
}

/** Monitors whose interval has elapsed, oldest check first. */
export async function dueMonitors(limit = 20): Promise<MonitorRecord[]> {
  const monitors = await prisma.monitor.findMany({
    where: { active: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit * 2,
    select: {
      id: true,
      type: true,
      target: true,
      webhookUrl: true,
      lastHash: true,
      lastSnapshot: true,
      intervalMinutes: true,
      lastCheckedAt: true,
      apiKey: { select: { allowedDomains: true, blockedDomains: true, webhookSecret: true } },
    },
  });

  const now = Date.now();
  return monitors
    .filter(
      (m) =>
        !m.lastCheckedAt || now - m.lastCheckedAt.getTime() >= m.intervalMinutes * 60_000
    )
    .slice(0, limit);
}
