import { NextRequest, NextResponse } from "next/server";
import { consume, LIMITS } from "@/lib/core/limits";
import { requestActor } from "@/lib/core/request";
import { rank } from "@/lib/rank/bm25";
import { chunkText } from "@/lib/rank/chunk";
import { fetchLiveData, DATA_KINDS } from "@/lib/data/live";
import { mapSite } from "@/lib/crawl/sitemap";
import { MCP_TOOLS, findTool } from "@/lib/mcp/tools";
import { newsCorpus, matchNews } from "@/lib/search/newsroom";
import { searchWeb } from "@/lib/search/engine";
import type { ApiContext } from "@/lib/api/gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * TEMPORARY. Exercises the request-shaped surfaces from inside the deployment.
 *
 * Every endpoint added recently is a POST behind an API key, and the tooling
 * available to me from outside can only issue GETs. So the whole of the live
 * data layer, site mapping, reranking, chunking and the MCP tools shipped
 * compiling and routing correctly but never actually run against the real
 * internet — which, on this project, has been exactly where the interesting
 * failures live. Six of them so far were only visible in a live response.
 *
 * This closes that gap without touching the database or the billing path:
 * it calls the same module-level functions the routes call, with a stub
 * context, and separately posts real JSON-RPC at our own MCP endpoint for the
 * methods that need no key. What it does not cover is the gateway itself —
 * authentication, credit reservation, rate limiting — and that path is already
 * exercised by every live search.
 */
/**
 * No fallback value, deliberately.
 *
 * This endpoint reaches out to roughly thirty third parties per call, and the
 * repository it lives in is public. A hard-coded default token would be
 * readable by everyone it is supposed to keep out, which is not a weak defence
 * but the appearance of one. Unset DIAG_TOKEN means the route does not exist.
 */
const TOKEN = process.env.DIAG_TOKEN ?? "";

/** No domain restrictions: the tools' own logic is what is under test. */
const STUB: ApiContext = { policy: {} };

interface Check {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}

async function check(name: string, run: () => Promise<string>): Promise<Check> {
  const started = Date.now();
  try {
    const detail = await run();
    return { name, ok: true, ms: Date.now() - started, detail: detail.slice(0, 220) };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message.slice(0, 220) : "bilinmeyen hata",
    };
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function GET(req: NextRequest) {
  if (!TOKEN || req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const verdict = await consume(LIMITS.diagnostics, requestActor(req));
  if (!verdict.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const started = Date.now();

  const checks: Check[] = [];

  /* ------------------------------------------------ pure computation */

  checks.push(
    await check("rerank", async () => {
      const ranked = rank("index bloat rebuild", [
        { id: "a", title: "Index bloat", text: "REINDEX CONCURRENTLY rebuilds the index." },
        { id: "b", title: "Pasta", text: "Boil water and add salt." },
      ]);
      expect(ranked[0].id === "a", `beklenen a, gelen ${ranked[0].id}`);
      expect(ranked[1].id === "b", "alakasız belge öne geçti");
      expect(Boolean(ranked[0].bestPassage), "kanıt pasajı boş");
      return `en iyi ${ranked[0].id} skor ${ranked[0].score}, pasaj: ${ranked[0].bestPassage}`;
    })
  );

  checks.push(
    await check("chunk", async () => {
      const chunks = chunkText("# Bir\n\nMetin.\n\n## İki\n\n" + "Dolgu cümlesi. ".repeat(120), {
        size: 400,
      });
      expect(chunks.length >= 2, `yalnızca ${chunks.length} parça`);
      expect(chunks.some((c) => c.headings.includes("İki")), "başlıklar yakalanmadı");
      return `${chunks.length} parça, başlıklar ${JSON.stringify(chunks.map((c) => c.headings))}`;
    })
  );

  /* ------------------------------------------------------- live data */

  for (const kind of DATA_KINDS) {
    checks.push(
      await check(`data:${kind}`, async () => {
        const result = await fetchLiveData({
          kind,
          place: "İzmir",
          base: "USD",
          symbols: ["TRY"],
          ids: ["bitcoin"],
          currencies: ["usd"],
          symbol: "AAPL",
          minMagnitude: 4,
          hours: 48,
          name: "Türkiye",
          countryCode: "TR",
          indicator: "inflation",
          years: 5,
        });
        expect(Object.keys(result.data).length > 0, "veri boş döndü");
        return `${result.source} · ölçüm ${result.observedAt ?? "yok"} · ${JSON.stringify(
          result.data
        ).slice(0, 150)}`;
      })
    );
  }

  /* ----------------------------------------------------------- map */

  for (const site of ["docs.python.org", "vercel.com"]) {
    checks.push(
      await check(`map:${site}`, async () => {
        const result = await mapSite(site, { limit: 25 });
        expect(result.urls.length > 0, "hiç adres bulunamadı");
        return `${result.urls.length} adres, ${result.urls[0].via}, haritalar: ${result.sitemaps.join(
          ", "
        ) || "yok"} · ${result.urls[0].url}`;
      })
    );
  }

  /* --------------------------------------------------------- search */

  checks.push(
    await check("search", async () => {
      const result = await searchWeb("postgres index bloat", { maxResults: 4 });
      expect(result.results.length > 0, "sonuç yok");
      return `${result.results.length} sonuç, ${result.provider}, ${result.tookMs}ms, ` +
        `içerik çıkarılan: ${result.results.filter((r) => r.content !== r.snippet).length}`;
    })
  );

  // The headline feature of the Clouda North patch: three latency/coverage
  // profiles. They typecheck and are unit-tested, but "fast is actually faster
  // than deep against the real internet" is only answerable from here.
  for (const depth of ["fast", "balanced", "deep"] as const) {
    checks.push(
      await check(`search:${depth}`, async () => {
        const result = await searchWeb(`site reliability engineering ${depth}`, {
          maxResults: 4,
          depth,
        });
        expect(result.results.length > 0, "sonuç yok");
        return `${result.results.length} sonuç, ${result.tookMs}ms, ${result.provider}`;
      })
    );
  }

  // A pasted link must be read, not searched for. Only answerable against the
  // real internet: the page has to actually come back.
  checks.push(
    await check("search:url", async () => {
      const url = "https://en.wikipedia.org/wiki/Database_index";
      const result = await searchWeb(url, { maxResults: 3 });
      expect(result.results.length > 0, "sonuç yok");
      expect(result.results[0].url === url, `ilk sonuç ${result.results[0].url}`);
      expect(result.results[0].content.length > 200, "sayfa metni çıkarılmadı");
      expect(result.plan.urlsOnly === true, "urlsOnly işaretlenmedi");
      return `${result.results[0].title} · ${result.results[0].content.length} karakter, ${result.tookMs}ms`;
    })
  );

  checks.push(
    await check("search:url+soru", async () => {
      const result = await searchWeb(
        "https://en.wikipedia.org/wiki/Database_index nedir bu index",
        { maxResults: 5 }
      );
      expect(result.plan.urls.length === 1, "adres ayrıştırılmadı");
      expect(result.plan.urlsOnly === false, "soru kısmı yok sayıldı");
      const pasted = result.results.findIndex((r) => r.url.includes("Database_index"));
      expect(pasted === 0, `yapıştırılan link ${pasted}. sırada`);
      expect(result.results.length > 1, "yalnızca link döndü, arama yapılmadı");
      return `${result.results.length} sonuç, ilki link, kaynak: ${result.provider}`;
    })
  );

  checks.push(
    await check("newsroom", async () => {
      const corpus = await newsCorpus({ blocking: true });
      expect(corpus.length > 0, "derlem boş");
      const hits = matchNews(corpus, "ekonomi", 3);
      return `${corpus.length} haber, en yeni ${corpus[0]?.publishedAt}, "ekonomi" için ${hits.length} eşleşme`;
    })
  );

  /* ------------------------------------------------------ mcp tools */

  const toolArgs: Record<string, Record<string, unknown>> = {
    clouda_search: { query: "postgres vacuum", max_results: 3, include_content: false },
    clouda_news: { query: "ekonomi", max_results: 3 },
    clouda_extract: { urls: ["https://en.wikipedia.org/wiki/Database_index"] },
    clouda_answer: { question: "what does REINDEX CONCURRENTLY do", max_sources: 4 },
    // The stub above is exercised for its shape; the assertion that the answer
    // is not itself a question lives in the check below.

    clouda_rerank: { query: "index bloat", documents: ["Index bloat grows.", "Boil pasta."] },
    clouda_chunk: { text: "# Baslik\n\n" + "Cumle. ".repeat(200), size: 400 },
    clouda_data: { kind: "fx", base: "USD", symbols: ["TRY"] },
    clouda_map: { url: "docs.python.org", limit: 10 },
  };

  for (const tool of MCP_TOOLS) {
    checks.push(
      await check(`mcp:${tool.name}`, async () => {
        const found = findTool(tool.name);
        expect(Boolean(found), "araç kayıtta bulunamadı");
        const { text } = await (found as typeof tool).run(toolArgs[tool.name] ?? {}, STUB);
        expect(text.length > 0, "araç boş metin döndürdü");

        // An answer that quotes a question back is worse than no answer, and
        // this is the check that caught it happening.
        if (tool.name === "clouda_answer") {
          const opening = text.split("\n")[0] ?? "";
          expect(
            !/\?\s*$/.test(opening.trim()) && !/^\s*\d+\.\s*(question|soru)\s*:/i.test(opening),
            `cevap bir soruyla açıldı: ${opening.slice(0, 100)}`
          );
        }

        return `${text.length} karakter: ${text.replace(/\s+/g, " ").slice(0, 130)}`;
      })
    );
  }

  /* ------------------------------------------------- mcp jsonrpc layer */

  const rpc = async (method: string, params?: Record<string, unknown>, id: number | null = 1) => {
    const res = await fetch(`${origin}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = res.status === 202 ? null : await res.json();
    return { status: res.status, body };
  };

  checks.push(
    await check("rpc:initialize", async () => {
      const { body } = await rpc("initialize", { protocolVersion: "2025-03-26" });
      expect(body?.result?.serverInfo?.name === "clouda", "serverInfo yanlış");
      expect(body.result.protocolVersion === "2025-03-26", "istenen protokol yansıtılmadı");
      return `protokol ${body.result.protocolVersion}, ${body.result.serverInfo.title}`;
    })
  );

  checks.push(
    await check("rpc:tools/list", async () => {
      const { body } = await rpc("tools/list");
      const tools = body?.result?.tools ?? [];
      expect(tools.length === MCP_TOOLS.length, `${tools.length} araç, beklenen ${MCP_TOOLS.length}`);
      expect(
        tools.every((t: { inputSchema?: unknown }) => Boolean(t.inputSchema)),
        "bir aracın şeması yok"
      );
      return `${tools.length} araç: ${tools.map((t: { name: string }) => t.name).join(", ")}`;
    })
  );

  checks.push(
    await check("rpc:tools/call yetkilendirmesi", async () => {
      const { body } = await rpc("tools/call", { name: "clouda_search", arguments: { query: "x" } });
      // Must be refused, and refused as a transport error rather than silently.
      // With no CLOUDA_TOKEN set the call is allowed, which is the point of a
      // local tool; with one set it must be refused. Both are correct, so the
      // check asserts they are consistent with the configuration.
      const guarded = Boolean(process.env.CLOUDA_TOKEN);
      if (guarded) {
        expect(Boolean(body?.error), "token tanımlıyken korumasız çağrı geçti");
        return `token isteniyor: ${body.error.message}`;
      }
      expect(!body?.error || body.error.code !== -32001, "token yokken kimlik istendi");
      return "token tanımlı değil, yerel çağrı kabul edildi";
    })
  );

  checks.push(
    await check("rpc:unknown method", async () => {
      const { body } = await rpc("does/not/exist");
      expect(body?.error?.code === -32601, "bilinmeyen metot için yanlış kod");
      return body.error.message;
    })
  );

  checks.push(
    await check("rpc:notification", async () => {
      const { status } = await rpc("notifications/initialized", undefined, null);
      expect(status === 202, `bildirim için ${status} döndü, 202 bekleniyordu`);
      return "202 Accepted";
    })
  );

  checks.push(
    await check("openapi", async () => {
      const res = await fetch(`${origin}/api/v1/openapi`);
      const spec = await res.json();
      expect(spec.openapi?.startsWith("3."), "openapi sürümü yok");
      const paths = Object.keys(spec.paths ?? {});
      expect(paths.length >= 12, `yalnızca ${paths.length} yol`);
      return `${paths.length} yol, ${Object.keys(spec["x-credits"] ?? {}).length} fiyat kalemi`;
    })
  );

  const failed = checks.filter((c) => !c.ok);

  return NextResponse.json(
    {
      ok: failed.length === 0,
      passed: checks.length - failed.length,
      failed: failed.length,
      total_ms: Date.now() - started,
      failures: failed,
      checks,
    },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
