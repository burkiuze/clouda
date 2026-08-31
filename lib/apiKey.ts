import { randomBytes, createHash } from "crypto";
import { API_KEY_PREFIX } from "@/lib/constants";

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  const hash = hashApiKey(plaintext);
  const prefix = `${plaintext.slice(0, API_KEY_PREFIX.length + 6)}...${plaintext.slice(-4)}`;
  return { plaintext, hash, prefix };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Secret used to sign this key's outbound webhooks. Without one, a monitor
 * callback is just an unauthenticated POST: anyone who learns the URL can
 * forge change notifications into the customer's system.
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}
