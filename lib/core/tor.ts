import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { CloudaError } from "@/lib/core/errors";

/**
 * Optional Tor transport, off unless an operator asks for it.
 *
 * Two things are deliberately separate here, because conflating them is the
 * usual way this feature goes wrong:
 *
 *   finding a .onion address needs no Tor at all — Ahmia indexes onion
 *   services and answers over the ordinary web (see lib/search/providers.ts);
 *
 *   reading the page behind that address needs a Tor circuit, because .onion
 *   is not a DNS name and nothing outside Tor can resolve it.
 *
 * So this module exists only for the second half. With TOR_SOCKS_PROXY unset
 * every .onion URL is refused by lib/core/security.ts exactly as before and
 * not one byte of traffic changes route.
 *
 * The address is resolved by the proxy (SOCKS5 ATYP=domain, i.e. socks5h
 * semantics), never locally: a .onion name must never reach a DNS resolver,
 * and an ordinary hostname routed over Tor must not leak through one either.
 */

const ONION_SUFFIX = ".onion";

/**
 * v3 onion addresses are 56 base32 characters. v2's 16-character addresses
 * were retired in 2021 and no longer resolve, so they are refused here rather
 * than dialled and waited on. Virtual hosts prefix labels onto the address, so
 * only the last two labels are checked.
 */
const V3_ONION = /^[a-z2-7]{56}\.onion$/;

function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isOnionHost(hostname: string): boolean {
  return normaliseHost(hostname).endsWith(ONION_SUFFIX);
}

export function isValidOnionHost(hostname: string): boolean {
  const labels = normaliseHost(hostname).split(".");
  return labels.length >= 2 && V3_ONION.test(labels.slice(-2).join("."));
}

export interface TorProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** TOR_SOCKS_PROXY, e.g. "socks5://127.0.0.1:9050" or bare "127.0.0.1:9050". */
export function torProxy(): TorProxy | null {
  const raw = process.env.TOR_SOCKS_PROXY?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `socks5://${raw}`);
  } catch {
    return null;
  }
  if (!["socks:", "socks5:", "socks5h:"].includes(url.protocol)) return null;
  const host = normaliseHost(url.hostname);
  if (!host) return null;
  const port = url.port ? Number(url.port) : 9050;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

export function torAvailable(): boolean {
  return torProxy() !== null;
}

function flagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

/**
 * Route every outbound fetch through Tor, not only .onion.
 *
 * Measured cost, not a guess about it: a circuit is three relays, so a fetch
 * that takes a few hundred milliseconds direct takes seconds through Tor, and
 * mainstream sources rate-limit or challenge exit nodes — which this codebase
 * already detects as a CAPTCHA and counts against the source's breaker. It is
 * here for the operator who needs the deployment's own address hidden, and it
 * is off unless they say so.
 */
export function torForAllTraffic(): boolean {
  return torAvailable() && flagEnabled(process.env.TOR_ALL_TRAFFIC);
}

export function shouldUseTor(hostname: string): boolean {
  if (!torAvailable()) return false;
  return isOnionHost(hostname) || torForAllTraffic();
}

/**
 * Whether onion services are offered as a search source. Setting a Tor proxy
 * is itself an explicit act, so it enables the source; CLOUDA_ONION_SEARCH
 * overrides in either direction, for an operator who wants onion *links*
 * without running Tor, or a Tor deployment that does not want them.
 */
export function onionSearchEnabled(): boolean {
  const flag = process.env.CLOUDA_ONION_SEARCH?.trim();
  if (flag) return flagEnabled(flag);
  return torAvailable();
}

/* ------------------------------------------------------------ SOCKS5 */

const SOCKS_VERSION = 0x05;
const AUTH_NONE = 0x00;
const AUTH_USER_PASS = 0x02;
const AUTH_UNACCEPTABLE = 0xff;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

/** Tor reuses the standard replies; 0x04 is what an unreachable or unknown
 * onion service comes back as, which is the failure operators actually hit. */
const SOCKS_REPLIES: Record<number, string> = {
  0x01: "SOCKS sunucusu genel hata döndürdü",
  0x02: "Bağlantıya kural gereği izin verilmedi",
  0x03: "Ağa ulaşılamıyor",
  0x04: "Hedefe ulaşılamıyor (onion servisi kapalı veya adres yanlış olabilir)",
  0x05: "Bağlantı reddedildi",
  0x06: "TTL süresi doldu",
  0x07: "Komut desteklenmiyor",
  0x08: "Adres türü desteklenmiyor",
};

interface Reader {
  read(want: number): Promise<Buffer>;
  detach(): void;
}

/** Reads exact byte counts during the handshake, then hands the socket back to
 * node:http with anything left over pushed in front of it. */
function attachReader(socket: net.Socket): Reader {
  let buffer = Buffer.alloc(0);
  let pending: { want: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  let failure: Error | null = null;

  const settle = () => {
    if (!pending) return;
    if (failure) {
      const { reject } = pending;
      pending = null;
      reject(failure);
      return;
    }
    if (buffer.length < pending.want) return;
    const { want, resolve } = pending;
    pending = null;
    const out = buffer.subarray(0, want);
    buffer = buffer.subarray(want);
    resolve(out);
  };
  const onData = (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]); settle(); };
  const onError = (error: Error) => { failure = error; settle(); };
  const onClose = () => { failure ??= new Error("SOCKS bağlantısı el sıkışma sırasında kapandı."); settle(); };

  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("close", onClose);

  return {
    read(want) {
      return new Promise<Buffer>((resolve, reject) => {
        pending = { want, resolve, reject };
        settle();
      });
    },
    detach() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (buffer.length) socket.unshift(buffer);
      buffer = Buffer.alloc(0);
    },
  };
}

function socksError(message: string): CloudaError {
  return new CloudaError("fetch_failed", `Tor: ${message}`);
}

async function socks5Connect(
  proxy: TorProxy, host: string, port: number, signal: AbortSignal
): Promise<net.Socket> {
  signal.throwIfAborted();
  const socket = net.connect({ host: proxy.host, port: proxy.port });
  socket.setNoDelay(true);
  const abort = () => socket.destroy(new Error("aborted"));
  signal.addEventListener("abort", abort, { once: true });
  const reader = attachReader(socket);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.once("close", () => reject(new Error("closed")));
    });

    const methods = proxy.username ? [AUTH_NONE, AUTH_USER_PASS] : [AUTH_NONE];
    socket.write(Buffer.from([SOCKS_VERSION, methods.length, ...methods]));
    const greeting = await reader.read(2);
    if (greeting[0] !== SOCKS_VERSION) throw socksError("proxy SOCKS5 konuşmuyor.");
    if (greeting[1] === AUTH_UNACCEPTABLE) throw socksError("proxy sunulan kimlik doğrulama yöntemlerini kabul etmedi.");

    if (greeting[1] === AUTH_USER_PASS) {
      if (!proxy.username) throw socksError("proxy kullanıcı adı/parola istedi ama tanımlı değil.");
      const user = Buffer.from(proxy.username, "utf8");
      const pass = Buffer.from(proxy.password ?? "", "utf8");
      if (user.length > 255 || pass.length > 255) throw socksError("proxy kimlik bilgisi çok uzun.");
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.read(2);
      if (auth[1] !== 0x00) throw socksError("proxy kimlik doğrulaması başarısız.");
    } else if (greeting[1] !== AUTH_NONE) {
      throw socksError(`proxy desteklenmeyen bir yöntem seçti: 0x${greeting[1].toString(16)}`);
    }

    // ATYP=domain, so the proxy resolves the name. A .onion never touches a
    // DNS resolver, and neither does an ordinary host routed over Tor.
    const name = Buffer.from(host, "utf8");
    if (name.length === 0 || name.length > 255) throw socksError("hedef ana bilgisayar adı geçersiz.");
    const target = Buffer.alloc(2);
    target.writeUInt16BE(port, 0);
    socket.write(Buffer.concat([
      Buffer.from([SOCKS_VERSION, CMD_CONNECT, 0x00, ATYP_DOMAIN, name.length]), name, target,
    ]));

    const head = await reader.read(4);
    if (head[0] !== SOCKS_VERSION) throw socksError("proxy bozuk yanıt döndürdü.");
    if (head[1] !== 0x00) throw socksError(SOCKS_REPLIES[head[1]] ?? `bilinmeyen hata 0x${head[1].toString(16)}`);
    const bound =
      head[3] === ATYP_IPV4 ? 4 :
      head[3] === ATYP_IPV6 ? 16 :
      head[3] === ATYP_DOMAIN ? (await reader.read(1))[0] : -1;
    if (bound < 0) throw socksError("proxy bilinmeyen adres türü döndürdü.");
    if (bound > 0) await reader.read(bound);
    await reader.read(2);

    reader.detach();
    signal.removeEventListener("abort", abort);
    return socket;
  } catch (error) {
    reader.detach();
    signal.removeEventListener("abort", abort);
    socket.destroy();
    if (error instanceof CloudaError) throw error;
    if (signal.aborted) throw new CloudaError("fetch_timeout", "Tor devresi süre sınırında kurulamadı.");
    throw socksError("SOCKS proxy'ye bağlanılamadı (TOR_SOCKS_PROXY doğru mu, Tor çalışıyor mu?).");
  }
}

/* ---------------------------------------------------------- HTTP over Tor */

export interface TorFetchInit {
  method?: string;
  headers?: Headers;
  body?: string | Buffer | null;
  maxBytes: number;
  signal: AbortSignal;
}

/** A Response, so safeFetch's redirect, cap and CAPTCHA handling is unchanged.
 * Compression is declined rather than decoded: node:http hands back raw bytes,
 * and a fetch that quietly returned gzip as text would be worse than a slower
 * one. */
export async function torFetch(rawUrl: string, init: TorFetchInit): Promise<Response> {
  const proxy = torProxy();
  if (!proxy) throw new CloudaError("blocked_url", "Tor devre dışı: TOR_SOCKS_PROXY tanımlı değil.");
  const url = new URL(rawUrl);
  const secure = url.protocol === "https:";
  if (!secure && url.protocol !== "http:") {
    throw new CloudaError("blocked_url", `Tor üzerinden yalnızca http ve https: ${url.protocol}`);
  }
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  const tunnel = await socks5Connect(proxy, url.hostname, port, init.signal);

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const headers: Record<string, string> = {};
    init.headers?.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    headers["host"] = url.host;
    headers["accept-encoding"] = "identity";
    headers["connection"] = "close";

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      tunnel.destroy();
      reject(error instanceof CloudaError ? error
        : init.signal.aborted ? new CloudaError("fetch_timeout", "Tor isteği süre sınırında tamamlanmadı.")
        : socksError("yanıt alınamadı."));
    };
    const onAbort = () => { request.destroy(new Error("aborted")); fail(null); };
    const cleanup = () => init.signal.removeEventListener("abort", onAbort);

    const request = (secure ? https : http).request({
      method: init.method ?? "GET",
      path: `${url.pathname}${url.search}` || "/",
      headers,
      // No `agent`, not even `agent: false`: false makes node build a throwaway
      // agent, and an agent dials the socket itself — which would open a direct
      // connection and ignore the circuit entirely. Leaving it unset is what
      // makes node use the socket handed back here.
      createConnection: () => secure
        ? tls.connect({
            socket: tunnel,
            servername: url.hostname,
            // An onion address IS the service's public key and the circuit is
            // authenticated by Tor itself, so a self-signed certificate there
            // is the norm rather than a downgrade. Anything else keeps normal
            // certificate verification.
            rejectUnauthorized: !isOnionHost(url.hostname),
          })
        : tunnel,
    });

    request.on("error", fail);
    request.on("response", (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        if (total >= init.maxBytes) return;
        const kept = chunk.subarray(0, init.maxBytes - total);
        chunks.push(kept);
        total += kept.length;
        if (total >= init.maxBytes) res.destroy();
      });
      res.on("error", fail);
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        tunnel.destroy();
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value == null) continue;
          for (const one of Array.isArray(value) ? value : [value]) {
            try { responseHeaders.append(name, one); } catch { /* header a Response would reject */ }
          }
        }
        const raw = res.statusCode ?? 0;
        const status = raw >= 200 && raw <= 599 ? raw : 502;
        const bodyless = status === 204 || status === 205 || status === 304;
        resolve(new Response(bodyless ? null : Buffer.concat(chunks, total), { status, headers: responseHeaders }));
      };
      res.on("end", finish);
      res.on("close", finish);
    });

    if (init.signal.aborted) { onAbort(); return; }
    init.signal.addEventListener("abort", onAbort, { once: true });
    if (init.body) request.write(init.body);
    request.end();
  });
}
