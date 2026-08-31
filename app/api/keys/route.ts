import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/apiKey";
import { CAPABILITIES, type Capability } from "@/lib/constants";

export const dynamic = "force-dynamic";

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
  const body = await req.json().catch(() => ({}));

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Anahtar";

  const rateLimitRaw = Number(body.rateLimitPerMin);
  const rateLimitPerMin = Number.isFinite(rateLimitRaw)
    ? Math.min(600, Math.max(1, Math.round(rateLimitRaw)))
    : 60;

  const capRaw = Number(body.creditCap);
  const creditCap = Number.isFinite(capRaw) && capRaw > 0 ? Math.round(capRaw) : null;

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
      allowedDomains: sanitizeDomains(body.allowedDomains),
      blockedDomains: sanitizeDomains(body.blockedDomains),
    },
  });

  return NextResponse.json({
    id: key.id,
    name: key.name,
    key: plaintext,
    prefix: key.keyPrefix,
    capabilities: key.capabilities,
    rateLimitPerMin: key.rateLimitPerMin,
    creditCap: key.creditCap,
    createdAt: key.createdAt,
  });
}
