import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/core/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** TEMPORARY. Measures candidate news feeds from this deployment's egress. */
const TOKEN = "probe_9f4c1a7e2b";

const FEEDS: { name: string; url: string; lang: string }[] = [
  { name: "aa-guncel", url: "https://www.aa.com.tr/tr/rss/default?cat=guncel", lang: "tr" },
  { name: "aa-ekonomi", url: "https://www.aa.com.tr/tr/rss/default?cat=ekonomi", lang: "tr" },
  { name: "bbc-turkce", url: "https://feeds.bbci.co.uk/turkce/rss.xml", lang: "tr" },
  { name: "trthaber", url: "https://www.trthaber.com/sondakika.rss", lang: "tr" },
  { name: "ntv-gundem", url: "https://www.ntv.com.tr/gundem.rss", lang: "tr" },
  { name: "ntv-ekonomi", url: "https://www.ntv.com.tr/ekonomi.rss", lang: "tr" },
  { name: "sozcu", url: "https://www.sozcu.com.tr/feed/", lang: "tr" },
  { name: "hurriyet-gundem", url: "https://www.hurriyet.com.tr/rss/gundem", lang: "tr" },
  { name: "dw-turkce", url: "https://rss.dw.com/rdf/rss-tur-all", lang: "tr" },
  { name: "bbc-world", url: "https://feeds.bbci.co.uk/news/world/rss.xml", lang: "en" },
  { name: "bbc-business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", lang: "en" },
  { name: "bbc-tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", lang: "en" },
  { name: "guardian-world", url: "https://www.theguardian.com/world/rss", lang: "en" },
  { name: "npr", url: "https://feeds.npr.org/1001/rss.xml", lang: "en" },
  { name: "aljazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", lang: "en" },
  { name: "nyt-world", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", lang: "en" },
  { name: "cnbc-top", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", lang: "en" },
  { name: "arstechnica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en" },
  { name: "theverge", url: "https://www.theverge.com/rss/index.xml", lang: "en" },
  { name: "techcrunch", url: "https://techcrunch.com/feed/", lang: "en" },
  { name: "sciencedaily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en" },
  { name: "reuters-world", url: "https://feeds.reuters.com/Reuters/worldNews", lang: "en" },
  { name: "ap-topnews", url: "https://feedx.net/rss/ap.xml", lang: "en" },
  { name: "yahoo-finance", url: "https://finance.yahoo.com/news/rssindex", lang: "en" },
];

/** Splits a feed into items regardless of whether it is RSS or Atom. */
function parseItems(body: string): { title: string; link: string }[] {
  const blocks = [...body.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map((m) => m[0]);
  const out: { title: string; link: string }[] = [];
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "";
    const link =
      block.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
      block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1] ??
      block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:[\s\S]*?)(?:\]\]>)?<\/guid>/)?.[1] ??
      "";
    if (title.trim() && link.trim()) out.push({ title: title.trim(), link: link.trim() });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      const started = Date.now();
      try {
        const res = await safeFetch(feed.url, { trusted: true, timeoutMs: 8000 });
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        const items = parseItems(res.body);
        return {
          name: feed.name,
          lang: feed.lang,
          ok: items.length > 0,
          count: items.length,
          ms: Date.now() - started,
          sample: items.slice(0, 2).map((i) => `${i.title} → ${i.link.slice(0, 70)}`),
        };
      } catch (err) {
        return {
          name: feed.name,
          lang: feed.lang,
          ok: false,
          count: 0,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message.slice(0, 90) : "unknown",
        };
      }
    })
  );
  results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms);
  return NextResponse.json({ ok: results.filter((r) => r.ok).length, total: results.length, results });
}
