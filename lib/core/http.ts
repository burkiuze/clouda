import { AsyncLocalStorage } from "node:async_hooks";
import { CloudaError } from "@/lib/core/errors";
import { assertUrlAllowed, DomainPolicy } from "@/lib/core/security";

/** One outbound path for providers, extraction, browse and monitors. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const CLOUDA_USER_AGENT = "CloudaBot/1.0 (+https://clouda.dev/bot)";

export interface FetchOptions extends Omit<RequestInit, "signal" | "redirect"> {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  policy?: DomainPolicy;
  /** Provider marker; even provider redirects must pass URL safety checks. */
  trusted?: boolean;
  signal?: AbortSignal | null;
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  etag?: string | null;
  lastModified?: string | null;
  body: string;
  bytes: number;
  chain: string[];
  tookMs: number;
}

const fetchScope = new AsyncLocalStorage<AbortSignal>();
/** A provider's entire fan-out shares cancellation, including nested helpers. */
export function withFetchSignal<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  return fetchScope.run(signal, task);
}

const CAPTCHA_MARKERS = [
  "captcha", "cf-challenge", "checking your browser", "unusual traffic",
  "are you a robot", "verify you are human",
];

function decodeBody(buffer: Buffer, contentType: string): string {
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const ascii = buffer.subarray(0, 2048).toString("latin1");
  const metaCharset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(ascii)?.[1];
  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();
  if (charset === "utf-8" || charset === "utf8") return buffer.toString("utf-8");
  try { return new TextDecoder(charset).decode(buffer); }
  catch { return buffer.toString("utf-8"); }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const kept = value.subarray(0, maxBytes - total);
      chunks.push(Buffer.from(kept));
      total += kept.byteLength;
    }
    if (total >= maxBytes) void reader.cancel().catch(() => {});
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

/** A single deadline includes every redirect AND the streaming response body. */
export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = 8000, maxBytes = 2_000_000, maxRedirects = 3, policy,
    trusted: _trusted, headers, signal: callerSignal, ...init
  } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new CloudaError("invalid_request", "Geçersiz HTTP süre/boyut/yönlendirme sınırı.");
  }
  const started = Date.now();
  const chain: string[] = [];
  let current = assertUrlAllowed(rawUrl, policy).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const inherited = fetchScope.getStore();
  const signals = [controller.signal, ...(callerSignal ? [callerSignal] : []), ...(inherited ? [inherited] : [])];
  const signal = signals.length === 1 ? controller.signal : AbortSignal.any(signals);
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("User-Agent")) requestHeaders.set("User-Agent", DEFAULT_USER_AGENT);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      signal.throwIfAborted();
      chain.push(current);
      const res = await fetch(current, { ...init, headers: requestHeaders, redirect: "manual", signal });
      const location = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        void res.body?.cancel().catch(() => {});
        if (!location || hop === maxRedirects) {
          throw new CloudaError("fetch_failed", "Yönlendirme hedefi yok veya yönlendirme sınırı aşıldı.", { url: current });
        }
        const next = assertUrlAllowed(new URL(location, current).toString(), policy).toString();
        if (new URL(next).origin !== new URL(current).origin) {
          for (const name of ["authorization", "cookie", "proxy-authorization", "api-key", "x-api-key"]) requestHeaders.delete(name);
        }
        // Match normal fetch redirect semantics for POST/303.
        if (res.status === 303 && init.method?.toUpperCase() !== "HEAD" ||
            [301, 302].includes(res.status) && init.method?.toUpperCase() === "POST") {
          init.method = "GET";
          delete init.body;
          for (const name of ["content-length", "content-type", "transfer-encoding"]) requestHeaders.delete(name);
        }
        current = next;
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const buffer = await readCapped(res, maxBytes);
      const body = decodeBody(buffer, contentType);
      if ([202, 403, 429].includes(res.status) &&
          CAPTCHA_MARKERS.some((marker) => body.slice(0, 4000).toLowerCase().includes(marker))) {
        throw new CloudaError("captcha_encountered", "Kaynak bot doğrulaması istedi.", { url: current, status: res.status });
      }
      return { url: current, status: res.status, contentType, body, bytes: buffer.length, chain,
        etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), tookMs: Date.now() - started };
    }
    throw new CloudaError("fetch_failed", "Yönlendirme sınırı aşıldı.", { url: rawUrl });
  } catch (error) {
    if (error instanceof CloudaError) throw error;
    throw new CloudaError(signal.aborted ? "fetch_timeout" : "fetch_failed",
      signal.aborted ? "İstek süre sınırında tamamlanmadı." : "Adrese ulaşılamadı.", { url: current, timeoutMs });
  } finally {
    clearTimeout(timer);
  }
}

export async function tryFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult | null> {
  try { return await safeFetch(rawUrl, options); }
  catch { return null; }
}
