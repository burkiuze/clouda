import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SIGNUP_FREE_CREDITS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    email?: string;
    password?: string;
    accountType?: string;
    companyName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const accountType = body.accountType === "organization" ? "organization" : "personal";
  const companyName = body.companyName?.trim() || null;

  if (!name) {
    return NextResponse.json({ message: "Adını yazman gerekiyor." }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ message: "Geçerli bir e-posta adresi gir." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: "Şifre en az 8 karakter olmalı." }, { status: 400 });
  }
  if (accountType === "organization" && !companyName) {
    return NextResponse.json({ message: "Kurum adını yazman gerekiyor." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { message: "Bu e-posta ile bir hesap zaten var. Giriş yapmayı dene." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      accountType,
      companyName,
      credits: SIGNUP_FREE_CREDITS,
    },
  });

  return NextResponse.json({ ok: true });
}
