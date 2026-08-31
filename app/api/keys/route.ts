import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/apiKey";

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
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as typeof session.user & { id: string }).id;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Default key";

  const { plaintext, hash, prefix } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: { userId, name, keyHash: hash, keyPrefix: prefix },
  });

  return NextResponse.json({
    id: key.id,
    name: key.name,
    key: plaintext,
    prefix: key.keyPrefix,
    createdAt: key.createdAt,
  });
}
