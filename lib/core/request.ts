import { createHash } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Identifying the caller of an unauthenticated request.
 *
 * Every value here is attacker-controlled except the one Vercel sets, so the
 * proxy header is read in the order Vercel actually populates it and never
 * trusted for anything but throttling.
 */

/** Best available client address. Falls back to a constant, which throttles all unknowns together. */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Stable pseudonym for an address. Raw IPs are personal data and there is no
 * reason to keep them: throttling and audit correlation only need equality.
 */
export function actorHash(value: string): string {
  const salt = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "clouda";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

/** Convenience: the hashed identifier for the caller of this request. */
export function requestActor(req: NextRequest): string {
  return actorHash(clientIp(req));
}
