import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey, generateWebhookSecret } from "@/lib/apiKey";
import { CAPABILITIES, type Capability } from "@/lib/constants";
import { consume, LIMITS } from "@/lib/core/limits";
import { recordSecurityEvent } from "@/lib/core/audit";

export const dynamic = "force-dynamic";

/** Ceiling on live keys per account, so a compromised session cannot mint thousands. */
const MAX_ACTIVE_KEYS = 25;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as typeof session.user & { id: string }).id;
  const keys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      revoked: true,
      capabilities: true,
      rateLimitPerMin: true,
      creditCap: true,
      creditsSpent: true,
      allowedDomains: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  return NextResponse.json({ keys });
}

function sanitizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(CAPABILITIES);
  return Array.from(new Set(input.filter((c): c is Capability => typeof c === "string" && valid.has(c))));
}

function sanitizeDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    )
  ).slice(0, 25);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as typeof session.user & { id: string }).id;

  const burst = await consume(LIMITS.keyCreate, userId);
  if (!burst.allowed) {
    return NextResponse.json(
      { message: "Çok fazla anahtar oluşturdun. Biraz sonra tekrar dene." },
      { status: 429, headers: { "Retry-After": String(burst.retryAfter) } }
    );
  }

  const activeKeys = await prisma.apiKey.count({ where: { userId, revoked: false } });
  if (activeKeys >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      {
        message: `En fazla ${MAX_ACTIVE_KEYS} aktif anahtarın olabilir. Kullanmadıklarını iptal et.`,
      },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Anahtar";

  const rateLimitRaw = Number(body.rateLimitPerMin);
  const rateLimitPerMin = Number.isFinite(rateLimitRaw)
    ? Math.min(600, Math.max(1, Math.round(rateLimitRaw)))
    : 60;

  const capRaw = Number(body.creditCap);
  const creditCap = Number.isFinite(capRaw) && capRaw > 0 ? Math.round(capRaw) : null;

  // Days until the key stops working. Bounded so "never expires" has to be
  // chosen deliberately rather than arrived at by passing a huge number.
  const daysRaw = Number(body.expiresInDays);
  const expiresAt =
    Number.isFinite(daysRaw) && daysRaw > 0
      ? new Date(Date.now() + Math.min(365, Math.round(daysRaw)) * 86_400_000)
      : null;

  const { plaintext, hash, prefix } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      capabilities: sanitizeCapabilities(body.capabilities),
      rateLimitPerMin,
      creditCap,
      expiresAt,
      webhookSecret: generateWebhookSecret(),
      allowedDomains: sanitizeDomains(body.allowedDomains),
      blockedDomains: sanitizeDomains(body.blockedDomains),
    },
  });

  await recordSecurityEvent({
    kind: "key_created",
    userId,
    detail: `${key.name} (${key.keyPrefix})`,
  });

  return NextResponse.json({
    id: key.id,
    name: key.name,
    // Shown once and never stored in the clear; the row keeps only the hash.
    key: plaintext,
    prefix: key.keyPrefix,
    capabilities: key.capabilities,
    rateLimitPerMin: key.rateLimitPerMin,
    creditCap: key.creditCap,
    expiresAt: key.expiresAt,
    // Lets the caller verify the signature on this key's monitor webhooks.
    webhookSecret: key.webhookSecret,
    createdAt: key.createdAt,
  });
}
