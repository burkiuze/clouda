/**
 * Deployment configuration, reported rather than assumed. Auth.js answers a
 * misconfigured deployment with an opaque "Configuration" error, so the app
 * needs to be able to say which variable is actually missing.
 */

export interface MissingVar {
  name: string;
  why: string;
}

export function missingAuthConfig(): MissingVar[] {
  const missing: MissingVar[] = [];

  if (!process.env.DATABASE_URL) {
    missing.push({
      name: "DATABASE_URL",
      why: "kullanıcılar, krediler ve API anahtarları burada saklanır",
    });
  }
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    missing.push({ name: "NEXTAUTH_SECRET", why: "oturum çerezlerini imzalar" });
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    missing.push({
      name: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET",
      why: "yalnızca Google ile giriş için gerekir",
    });
  }

  return missing;
}

export const hasDatabase = () => Boolean(process.env.DATABASE_URL);
