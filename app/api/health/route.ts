import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { missingAuthConfig } from "@/lib/config";

/**
 * One request that answers "is this deployment actually wired up?".
 * Configuration problems are otherwise only visible as a failed sign-up, so
 * this reports each dependency separately instead of a single pass/fail.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Check {
  ok: boolean;
  detail: string;
}

async function checkDatabase(): Promise<Check> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, detail: "DATABASE_URL tanımlı değil." };
  }
  const startedAt = Date.now();
  try {
    const [{ users }] = await prisma.$queryRaw<{ users: bigint }[]>`
      SELECT count(*)::bigint AS users FROM "User"
    `;
    return {
      ok: true,
      detail: `Bağlandı (${Date.now() - startedAt} ms), ${Number(users)} kullanıcı kayıtlı.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: message.split("\n")[0].slice(0, 300) };
  }
}

export async function GET() {
  const database = await checkDatabase();
  const missing = missingAuthConfig();

  const checks = {
    database,
    sessionSecret: {
      ok: Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
      detail: "Oturum çerezlerini imzalar (NEXTAUTH_SECRET).",
    },
    googleOAuth: {
      ok: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      detail: "Yalnızca Google ile giriş için gerekir.",
    },
    searchProvider: {
      // Search runs entirely on open sources; there is no key to configure.
      ok: true,
      detail: "Açık kaynaklar üzerinden çalışıyor, anahtar gerekmiyor.",
    },
  };

  // Sign-up and login need the database and a session secret; everything else
  // degrades rather than breaks, so it does not decide the overall status.
  const ready = checks.database.ok && checks.sessionSecret.ok;

  return NextResponse.json(
    {
      ready,
      checks,
      missing: missing.map((m) => m.name),
    },
    { status: ready ? 200 : 503 }
  );
}
