import { NextRequest, NextResponse } from "next/server";

/**
 * Response headers the browser enforces on our behalf.
 *
 * On script-src this policy allows 'unsafe-inline' rather than using a nonce.
 * That is a deliberate trade-off, not an oversight: the marketing pages are
 * statically rendered, so their HTML is written at build time and cannot carry
 * a per-request nonce. Pairing a nonce with 'strict-dynamic' would therefore
 * block every script on those pages — a strict policy that serves a blank site
 * is worse than an honest one. What the policy still buys is real: no script
 * may be loaded from another origin, nothing can be framed or frame us, and
 * base-uri and form-action cannot be repointed.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  // Tailwind emits a style element, React sets inline styles, and the layout
  // pulls Inter and Source Serif from Google Fonts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Google profile pictures on the dashboard, plus inline SVG data URIs.
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
  // The stylesheet above resolves its font files from this origin.
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  // Nothing here should be embedded, and nothing here embeds anything.
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/** Endpoints meant to be called from other origins with a Bearer key. */
function isPublicApi(pathname: string): boolean {
  return pathname.startsWith("/api/v1/") || pathname === "/api/mcp" || pathname === "/api/health";
}

export function middleware(req: NextRequest) {
  // A preflight must be answered before anything else: the browser sends it
  // without the Authorization header, so letting it reach a route that demands
  // one would fail every cross-origin call.
  if (req.method === "OPTIONS" && isPublicApi(req.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const res = NextResponse.next();
  const isDev = process.env.NODE_ENV === "development";

  // The dev server evaluates its hot-reload runtime, which eval-based CSP
  // blocks outright.
  res.headers.set(
    "Content-Security-Policy",
    isDev ? CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") : CSP
  );

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  // Only meaningful over TLS, and setting it in development would pin the
  // browser to https://localhost.
  if (!isDev) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  // API responses are per-caller and must never be held by a shared cache.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.headers.set("X-Robots-Tag", "noindex");
  }

  // The public API and the MCP endpoint are called from other origins by
  // design — agent runtimes, notebooks, browser-side clients.
  //
  // Allowing any origin is safe here specifically because these endpoints
  // authenticate with a Bearer header and never with a cookie: a page on
  // another origin can only reach them by supplying a key it already has, and
  // a browser will not attach our session cookie to the request. That is also
  // why credentials are not allowed — enabling both together is the
  // combination that turns this into cross-site request forgery.
  if (isPublicApi(req.nextUrl.pathname)) {
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
    res.headers.set(
      "Access-Control-Expose-Headers",
      "X-Clouda-Credits-Remaining, X-Clouda-RateLimit-Limit"
    );
    res.headers.set("Access-Control-Max-Age", "86400");
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except static assets, which are served straight from the CDN
    // and gain nothing from these headers.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
