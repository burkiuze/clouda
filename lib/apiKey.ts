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
