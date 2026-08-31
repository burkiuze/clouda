import { CloudaError } from "@/lib/core/errors";
import { assertUrlAllowed, DomainPolicy } from "@/lib/core/security";

/**
 * The single outbound HTTP path. Everything the platform fetches — provider
 * APIs, result pages, monitored URLs — goes through here so that timeouts,
 * size caps, redirect policy and SSRF checks are applied uniformly.
 */

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const CLOUDA_USER_AGENT = "CloudaBot/1.0 (+https://clouda.dev/bot)";

export interface FetchOptions extends Omit<RequestInit, "signal" | "redirect"> {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  policy?: DomainPolicy;
  /** Skips SSRF checks for first-party provider endpoints we control. */
  trusted?: boolean;
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  /** Redirect chain actually followed, ending at `url`. */
  chain: string[];
  tookMs: number;
}

const DEFAULT_TIMEOUT = 8000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 3;

/** Signatures of interstitial bot checks, which are not real page content. */
const CAPTCHA_MARKERS = [
  "captcha",
  "cf-challenge",
  "checking your browser",
  "unusual traffic",
  "are you a robot",
  "verify you are human",
];

function looksLikeCaptcha(body: string, status: number): boolean {
  if (status === 202 || status === 403 || status === 429) {
    const head = body.slice(0, 4000).toLowerCase();
    return CAPTCHA_MARKERS.some((m) => head.includes(m));
  }
  return false;
}

/** Decodes a body using the charset the response declares, not just UTF-8. */
function decodeBody(buffer: Buffer, contentType: string): string {
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const ascii = buffer.subarray(0, 2048).toString("latin1");
  const metaCharset =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(ascii)?.[1];

  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();
  if (charset === "utf-8" || charset === "utf8") return buffer.toString("utf-8");
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf-8");
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { buffer: Buffer.alloc(0), truncated: false };

  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(Buffer.from(value));
  }

  return { buffer: Buffer.concat(chunks), truncated };
}

/**
 * Fetches a URL with redirects followed manually, so that every hop is
 * re-validated against the SSRF policy rather than only the first one.
 */
export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    policy,
    trusted = false,
    headers,
    ...init
  } = options;

  const started = Date.now();
  const chain: string[] = [];
  let current = trusted ? rawUrl : assertUrlAllowed(rawUrl, policy).toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    chain.push(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(current, {
        ...init,
        headers: { "User-Agent": DEFAULT_USER_AGENT, ...(headers ?? {}) },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new CloudaError(
        aborted ? "fetch_timeout" : "fetch_failed",
        aborted
          ? `İstek ${timeoutMs}ms içinde tamamlanmadı: ${current}`
          : `Adrese ulaşılamadı: ${current}`,
        { url: current }
      );
    }

    // Redirects are followed by hand so each destination is policy-checked.
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const location = res.headers.get("location");
      if (!location) {
        throw new CloudaError("fetch_failed", `Yönlendirme hedefi yok: ${current}`);
      }
      const next = new URL(location, current).toString();
      current = trusted ? next : assertUrlAllowed(next, policy).toString();
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const { buffer, truncated } = await readCapped(res, maxBytes);
    clearTimeout(timer);

    const body = decodeBody(buffer, contentType);

    if (looksLikeCaptcha(body, res.status)) {
      throw new CloudaError(
        "captcha_encountered",
        `Kaynak bot doğrulaması istedi: ${new URL(current).hostname}`,
        { url: current, status: res.status }
      );
    }

    if (truncated && buffer.length === 0) {
      throw new CloudaError("page_too_large", `Sayfa ${maxBytes} bayt sınırını aştı: ${current}`);
    }

    return {
      url: current,
      status: res.status,
      contentType,
      body,
      bytes: buffer.length,
      chain,
      tookMs: Date.now() - started,
    };
  }

  throw new CloudaError("fetch_failed", `Çok fazla yönlendirme: ${rawUrl}`);
}

/** Convenience wrapper that returns null instead of throwing. */
export async function tryFetch(
  rawUrl: string,
  options: FetchOptions = {}
): Promise<FetchResult | null> {
  try {
    return await safeFetch(rawUrl, options);
  } catch {
    return null;
  }
}
