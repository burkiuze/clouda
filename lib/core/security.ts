import { CloudaError } from "@/lib/core/errors";

/**
 * URL policy for everything the platform fetches on a caller's behalf.
 *
 * The API takes URLs from untrusted input (agents, search results, monitors),
 * so a request could otherwise be aimed at the deployment's own network. Every
 * outbound fetch goes through `assertUrlAllowed` first.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hosts that resolve inside the infrastructure rather than on the public web. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".cluster.local", ".onion"];

/** Literal addresses in private, loopback, link-local and carrier-NAT ranges. */
function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");

  // IPv6 loopback and unique-local / link-local prefixes.
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;

  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if ([a, Number(v4[2]), Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved

  return false;
}

export interface DomainPolicy {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const p = pattern.toLowerCase().replace(/^\*\./, "").replace(/^\./, "");
  return host === p || host.endsWith(`.${p}`);
}

/**
 * Validates a URL for outbound fetching and returns its normalised form.
 * Throws a CloudaError describing precisely why a URL was refused.
 */
export function assertUrlAllowed(rawUrl: string, policy: DomainPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CloudaError("invalid_url", `Geçersiz URL: ${rawUrl.slice(0, 200)}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new CloudaError("blocked_url", `Yalnızca http ve https destekleniyor: ${url.protocol}`);
  }
  // Credentials in a URL are a classic way to confuse a fetching proxy.
  if (url.username || url.password) {
    throw new CloudaError("blocked_url", "Kullanıcı bilgisi içeren URL'ler kabul edilmiyor.");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new CloudaError("invalid_url", "URL bir ana bilgisayar adı içermiyor.");

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new CloudaError("blocked_url", `Bu ana bilgisayara erişim engelli: ${hostname}`);
  }
  if (isPrivateAddress(hostname)) {
    throw new CloudaError("blocked_url", `Özel ağ adresine istek yapılamaz: ${hostname}`);
  }

  const blocked = policy.blockedDomains ?? [];
  if (blocked.some((d) => hostMatches(hostname, d))) {
    throw new CloudaError("domain_not_allowed", `Bu alan adı anahtar için engellenmiş: ${hostname}`);
  }

  const allowed = policy.allowedDomains ?? [];
  if (allowed.length > 0 && !allowed.some((d) => hostMatches(hostname, d))) {
    throw new CloudaError(
      "domain_not_allowed",
      `Bu anahtar yalnızca izin verilen alan adlarına erişebilir: ${hostname}`
    );
  }

  return url;
}

/** Non-throwing variant, for filtering lists of candidate URLs. */
export function isUrlAllowed(rawUrl: string, policy: DomainPolicy = {}): boolean {
  try {
    assertUrlAllowed(rawUrl, policy);
    return true;
  } catch {
    return false;
  }
}
