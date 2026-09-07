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

/**
 * How this installation identifies itself to the outside world.
 *
 * Several sources ask callers to say who they are, and mean it: OpenAlex gives
 * a contact address its faster "polite pool", and the SEC requires a User-Agent
 * naming a real party. Those values were hard-coded to this project's own
 * address, which is fine for one deployment and wrong for an open-source one —
 * every fork would then be pooling its traffic under an address its operator
 * does not control and cannot be reached at. Worse, the rate limit that
 * eventually lands falls on whoever owns the address rather than on whoever
 * made the requests.
 *
 * So it is configurable, with this project as the default. An operator running
 * this seriously should set CLOUDA_CONTACT_EMAIL to their own.
 */
export function contactEmail(): string {
  return process.env.CLOUDA_CONTACT_EMAIL || "hello@clouda.dev";
}

export function userAgent(): string {
  const custom = process.env.CLOUDA_USER_AGENT;
  if (custom) return custom;
  return `Clouda/1.0 (+https://github.com/burkiuze/clouda; ${contactEmail()})`;
}

/**
 * The externally reachable address of this installation, for the examples the
 * UI prints. Unset means a local install, which is the honest default for a
 * repository someone has just cloned.
 */
export function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
