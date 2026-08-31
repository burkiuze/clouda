import { prisma } from "@/lib/prisma";

/**
 * The security trail. Kept apart from UsageLog so that sign-in failures and
 * throttling stay legible when API traffic is loud.
 *
 * Writes never throw: an audit failure must not take down the request it is
 * describing, and a refused sign-in should still be refused if the log is
 * unavailable.
 */

export type SecurityEventKind =
  | "signup"
  | "signup_throttled"
  | "signup_weak_password"
  | "login_failed"
  | "login_throttled"
  | "auth_link_blocked"
  | "key_created"
  | "key_revoked"
  | "key_expired_use"
  | "demo_throttled";

export interface SecurityEventInput {
  kind: SecurityEventKind;
  userId?: string | null;
  actorHash?: string | null;
  /** Short human-readable context. Never a password, token or raw address. */
  detail?: string | null;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.securityEvent.create({
      data: {
        kind: input.kind,
        userId: input.userId ?? null,
        actorHash: input.actorHash ?? null,
        detail: input.detail?.slice(0, 300) ?? null,
      },
    });
  } catch {
    // Logging is best effort by design.
  }
}

export interface SecurityEventRow {
  id: string;
  kind: string;
  detail: string | null;
  createdAt: Date;
}

/** Recent events for one account, for the dashboard's activity panel. */
export async function recentSecurityEvents(
  userId: string,
  take = 20
): Promise<SecurityEventRow[]> {
  try {
    return await prisma.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, kind: true, detail: true, createdAt: true },
    });
  } catch {
    return [];
  }
}
