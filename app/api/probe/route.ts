import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function titles(xml: string) {
  const $ = cheerio.load(xml, { xml: true });
  const out: string[] = [];
  $("item").each((_, el) => {
    if (out.length >= 4) return;
    out.push(
      `${$(el).find("title").first().text().trim().slice(0, 60)} | ${$(el)
        .find("link")
        .first()
        .text()
        .trim()
        .slice(0, 60)}`
    );
  });
  return out;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "vektör veritabanı nedir";
  const e = encodeURIComponent(q);

  const variants: Record<string, string> = {
    plain: `https://www.bing.com/search?q=${e}&format=rss&count=10`,
    mkt: `https://www.bing.com/search?q=${e}&format=rss&count=10&mkt=tr-TR`,
    setlang: `https://www.bing.com/search?q=${e}&format=rss&count=10&setlang=tr`,
    mkt_setlang: `https://www.bing.com/search?q=${e}&format=rss&count=10&mkt=tr-TR&setlang=tr`,
    mkt_adlt: `https://www.bing.com/search?q=${e}&format=rss&count=10&mkt=tr-TR&adlt=strict`,
    plain_adlt: `https://www.bing.com/search?q=${e}&format=rss&count=10&adlt=strict`,
    cc_adlt: `https://www.bing.com/search?q=${e}&format=rss&count=10&cc=TR&adlt=strict`,
  };

  const out: Record<string, unknown> = { query: q };
  await Promise.all(
    Object.entries(variants).map(async ([name, url]) => {
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        const xml = await res.text();
        out[name] = { status: res.status, bytes: xml.length, titles: titles(xml) };
      } catch (err) {
        out[name] = { error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return NextResponse.json(out);
}
