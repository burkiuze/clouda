import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const targets: { name: string; run: () => Promise<Response> }[] = [
  {
    name: "ddg-html-post",
    run: () =>
      fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: "openai" }).toString(),
      }),
  },
  {
    name: "ddg-lite-post",
    run: () =>
      fetch("https://lite.duckduckgo.com/lite/", {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: "openai" }).toString(),
      }),
  },
  {
    name: "ddg-instant-api",
    run: () =>
      fetch("https://api.duckduckgo.com/?q=openai&format=json&no_html=1", {
        headers: { "User-Agent": UA },
      }),
  },
  {
    name: "bing-rss",
    run: () =>
      fetch("https://www.bing.com/search?q=openai&format=rss", { headers: { "User-Agent": UA } }),
  },
  {
    name: "mojeek-html",
    run: () =>
      fetch("https://www.mojeek.com/search?q=openai", { headers: { "User-Agent": UA } }),
  },
  {
    name: "marginalia",
    run: () =>
      fetch("https://search.marginalia.nu/search?query=openai", { headers: { "User-Agent": UA } }),
  },
  {
    name: "wikipedia-search",
    run: () =>
      fetch(
        "https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=openai&format=json",
        { headers: { "User-Agent": "Clouda/0.1 (https://clouda.dev)" } }
      ),
  },
  {
    name: "google-news-rss",
    run: () =>
      fetch("https://news.google.com/rss/search?q=openai", { headers: { "User-Agent": UA } }),
  },
  {
    name: "startpage-html",
    run: () =>
      fetch("https://www.startpage.com/sp/search?query=openai", { headers: { "User-Agent": UA } }),
  },
  {
    name: "brave-html",
    run: () =>
      fetch("https://search.brave.com/search?q=openai", { headers: { "User-Agent": UA } }),
  },
];

export async function GET(_req: NextRequest) {
  const results = await Promise.all(
    targets.map(async (t) => {
      const start = Date.now();
      try {
        const res = await t.run();
        const body = await res.text();
        return {
          name: t.name,
          status: res.status,
          ms: Date.now() - start,
          bytes: body.length,
          head: body.slice(0, 160).replace(/\s+/g, " "),
        };
      } catch (err) {
        return {
          name: t.name,
          status: "ERR",
          ms: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return NextResponse.json({ results });
}
