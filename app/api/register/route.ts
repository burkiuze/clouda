import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SIGNUP_FREE_CREDITS } from "@/lib/constants";
import { CloudaError, toCloudaError } from "@/lib/core/errors";
import { consume, LIMITS } from "@/lib/core/limits";
import { requestActor } from "@/lib/core/request";
import { recordSecurityEvent } from "@/lib/core/audit";
import { checkPassword, BCRYPT_ROUNDS } from "@/lib/core/password";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    return await register(req);
  } catch (err) {
    const error = toCloudaError(err);
    return NextResponse.json(error.toJSON(), { status: error.status });
  }
}

function throttled(retryAfter: number) {
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Çok fazla kayıt denemesi yapıldı. Biraz sonra tekrar dene.",
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

async function register(req: NextRequest) {
  // Without a database there is nowhere to put the account; say so plainly
  // rather than failing deeper with an opaque driver error.
  if (!process.env.DATABASE_URL) {
    throw new CloudaError(
      "database_unavailable",
      "Veritabanı bağlı değil. Vercel'de DATABASE_URL tanımlanmadan kayıt oluşturulamaz."
    );
  }

  // Every account is created with free credits, so an unthrottled sign-up
  // endpoint is a free-compute faucet: mint accounts, harvest credits. Both an
  // hourly and a daily window are counted so a slow drip is caught too.
  const actor = requestActor(req);
  const hourly = await consume(LIMITS.register, actor);
  if (!hourly.allowed) {
    await recordSecurityEvent({
      kind: "signup_throttled",
      actorHash: actor,
      detail: `hourly window, ${hourly.count} attempts`,
    });
    return throttled(hourly.retryAfter);
  }
  const daily = await consume(LIMITS.registerBurst, actor);
  if (!daily.allowed) {
    await recordSecurityEvent({
      kind: "signup_throttled",
      actorHash: actor,
      detail: `daily window, ${daily.count} attempts`,
    });
    return throttled(daily.retryAfter);
  }

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

  const name = body.name?.trim().slice(0, 100);
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const accountType = body.accountType === "organization" ? "organization" : "personal";
  const companyName = body.companyName?.trim().slice(0, 120) || null;

  if (!name) {
    return NextResponse.json({ message: "Adını yazman gerekiyor." }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ message: "Geçerli bir e-posta adresi gir." }, { status: 400 });
  }
  if (accountType === "organization" && !companyName) {
    return NextResponse.json({ message: "Kurum adını yazman gerekiyor." }, { status: 400 });
  }

  const verdict = checkPassword(password, email, name);
  if (!verdict.ok) {
    await recordSecurityEvent({
      kind: "signup_weak_password",
      actorHash: actor,
      detail: verdict.message,
    });
    return NextResponse.json({ message: verdict.message }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Letting the unique index decide avoids a check-then-insert race where two
  // concurrent sign-ups for the same address both pass the lookup.
  //
  // This does tell a caller whether an address is registered. Hiding it would
  // mean claiming an account was created when it was not, and with no email
  // delivery the user would be stuck at a sign-in that never works. The
  // enumeration risk is answered by the rate limit above instead: three
  // addresses an hour is not a usable oracle.
  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        accountType,
        companyName,
        credits: SIGNUP_FREE_CREDITS,
      },
      select: { id: true },
    });

    await recordSecurityEvent({ kind: "signup", userId: user.id, actorHash: actor });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { message: "Bu e-posta ile bir hesap zaten var. Giriş yapmayı dene." },
        { status: 409 }
      );
    }
    throw err;
  }
}
