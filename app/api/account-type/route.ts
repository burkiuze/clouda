import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as typeof session.user & { id: string }).id;
  const body = await req.json().catch(() => ({}));

  const accountType = body.accountType === "organization" ? "organization" : "personal";
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";

  if (accountType === "organization" && !companyName) {
    return NextResponse.json({ message: "Kurum adını yazman gerekiyor." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { accountType, companyName: accountType === "organization" ? companyName : null },
  });

  return NextResponse.json({ ok: true });
}
