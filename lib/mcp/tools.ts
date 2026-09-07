import type { ApiContext } from "@/lib/api/gateway";
import { CREDITS, Capability } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { parseSearchDepth, parseFreshness, parseDomains, parseLocale } from "@/lib/api/shapes";
import { searchWeb } from "@/lib/search/engine";
import { fetchAndExtract } from "@/lib/search/extract";
import { matchNews, newsCorpus } from "@/lib/search/newsroom";
import { rank } from "@/lib/rank/bm25";
import { chunkText } from "@/lib/rank/chunk";
import { DATA_KINDS, DataKind, fetchLiveData, INDICATOR_NAMES } from "@/lib/data/live";
import { mapSite } from "@/lib/crawl/sitemap";
import { verifyClaims } from "@/lib/research/citations";

/**
 * Clouda as a set of MCP tools.
 *
 * The REST API is for code somebody writes. This is for the agent itself: an
 * MCP client connects once, reads the list below, and the model can then call
 * search or news the same way it calls anything else — no client library, no
 * integration written by hand, no guessing at parameter names.
 *
 * Each tool declares its own price rather than inheriting one from the HTTP
 * request, because a single MCP connection carries many calls and they do not
 * cost the same.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Capability the key must carry; absent means always available. */
  capability?: Capability;
  /** Worst-case price, reserved before the call. */
  estimate: number;
  run(args: Record<string, unknown>, ctx: ApiContext): Promise<{ text: string; credits: number }>;
}

function str(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    if (required) throw new CloudaError("invalid_request", `'${key}' zorunlu bir metin alanı.`);
    return "";
  }
  return value.trim();
}

function num(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CloudaError("invalid_request", `'${key}' sayı olmalı.`);
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Results are rendered as text rather than JSON.
 *
 * MCP tool output goes into a model's context, and a model reads prose better
 * than it reads a nested object — a JSON blob spends tokens on braces and
 * field names that repeat on every result. Numbers a caller might act on
 * (scores, dates, URLs) stay explicit; the packaging does not.
 */
function renderResults(
  heading: string,
  items: { title: string; url: string; body: string; meta?: string }[]
): string {
  if (items.length === 0) return `${heading}\n\n(sonuç yok)`;
  return [
    heading,
    "",
    ...items.map((item, i) =>
      [
        `${i + 1}. ${item.title}`,
        `   ${item.url}`,
        item.meta ? `   ${item.meta}` : null,
        item.body ? `   ${item.body.replace(/\s+/g, " ").slice(0, 700)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n");
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "clouda_search",
    description:
      "Web'de arar ve bulduğu sayfaların okunabilir metnini çıkarır. Güncel bilgi, " +
      "teknik sorular, ürün karşılaştırmaları için. Her sonuç ilgililik, güvenilirlik " +
      "ve tazelik skorlarıyla gelir.",
    estimate: CREDITS.search,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Arama sorgusu." },
        max_results: { type: "integer", description: "1-20, varsayılan 6.", minimum: 1, maximum: 20 },
        freshness: {
          anyOf: [{ type: "string" }, { type: "number", exclusiveMinimum: 0 }],
          description: "hour | day | week | month | year veya pozitif saat sayısı.",
        },
        include_content: {
          type: "boolean",
          description: "false ise sayfa metni indirilmez; daha az ağ isteği ve daha düşük kredi maliyeti.",
        },
        search_depth: { type: "string", enum: ["fast", "balanced", "deep"], default: "balanced" },
        locale: { type: "string", description: "Örnek: tr-TR, en-US." },
        no_cache: { type: "boolean" },
        exclude_domains: { type: "array", items: { type: "string" } },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description: "Yalnızca bu alan adlarından sonuç.",
        },
      },
      required: ["query"],
    },
    async run(args, ctx) {
      const includeContent = args.include_content !== false;
      const result = await searchWeb(str(args, "query"), {
        maxResults: num(args, "max_results", 6, 1, 20),
        includeContent,
        freshnessHours: parseFreshness(args.freshness),
        depth: parseSearchDepth(args.search_depth),
        locale: parseLocale(args.locale),
        noCache: args.no_cache === true,
        domainPolicy: ctx.policy,
        domainFilter: {
          include: parseDomains(args.include_domains, "include_domains"),
          exclude: parseDomains(args.exclude_domains, "exclude_domains"),
        },
      });

      const text = renderResults(
        `"${result.query}" için ${result.results.length} sonuç (kaynak: ${result.provider})`,
        result.results.map((r) => ({
          title: r.title,
          url: r.url,
          body: includeContent ? r.content : r.snippet,
          meta: [
            r.publishedAt ? `yayın: ${r.publishedAt.slice(0, 10)}` : null,
            `ilgililik ${r.scores.relevance}`,
            `güvenilirlik ${r.scores.credibility}`,
          ]
            .filter(Boolean)
            .join(" · "),
        }))
      );

      return {
        text,
        credits: result.cacheHit ? 0 : includeContent ? CREDITS.search : CREDITS.searchNoContent,
      };
    },
  },

  {
    name: "clouda_news",
    description:
      "Yayıncı beslemelerinden canlı haber getirir. Sorgu opsiyoneldir: boş bırakırsan " +
      "en son manşetleri döner. Adresler gerçek makale adresleridir, okunabilir.",
    estimate: CREDITS.search,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Opsiyonel. Boşsa manşetler döner." },
        lang: { type: "string", enum: ["tr", "en"], description: "Dil filtresi." },
        max_results: { type: "integer", minimum: 1, maximum: 25 },
        freshness_hours: { type: "integer", description: "Yalnızca son N saatteki haberler." },
      },
    },
    async run(args) {
      const corpus = await newsCorpus({ blocking: true });
      const query = str(args, "query", false);
      const lang = typeof args.lang === "string" ? args.lang : null;
      const pool = lang ? corpus.filter((c) => c.lang === lang) : corpus;
      const limit = num(args, "max_results", 8, 1, 25);
      const freshness = args.freshness_hours == null ? null : num(args, "freshness_hours", 24, 1, 8760);

      const items = query
        ? matchNews(pool, query, limit, freshness)
        : pool
            .filter((item) => {
              if (freshness == null || !item.publishedAt) return true;
              const ts = Date.parse(item.publishedAt);
              return Number.isNaN(ts) || ts >= Date.now() - freshness * 3_600_000;
            })
            .slice(0, limit);

      return {
        text: renderResults(
          query ? `"${query}" haberleri (${items.length})` : `Son manşetler (${items.length})`,
          items.map((i) => ({
            title: i.title,
            url: i.url,
            body: i.snippet,
            meta: `${i.source} · ${i.publishedAt?.slice(0, 16).replace("T", " ") ?? "tarih yok"}`,
          }))
        ),
        credits: CREDITS.searchNoContent,
      };
    },
  },

  {
    name: "clouda_extract",
    description:
      "Verilen adresleri indirip modele hazır düz metne çevirir. Elinde adres varken " +
      "arama yapmak yerine bunu kullan.",
    estimate: CREDITS.extractBase + CREDITS.extractPerUrl * 5,
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "En fazla 5 adres.",
        },
      },
      required: ["urls"],
    },
    async run(args, ctx) {
      const urls = Array.isArray(args.urls)
        ? (args.urls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 5)
        : [];
      if (urls.length === 0) throw new CloudaError("invalid_request", "'urls' en az bir adres içermeli.");

      const pages = await Promise.all(
        urls.map(async (url) => {
          const page = await fetchAndExtract(url, { policy: ctx.policy, timeoutMs: 4000 }).catch(
            () => null
          );
          return { url, page };
        })
      );

      const text = pages
        .map(({ url, page }) =>
          page
            ? `### ${page.title}\n${url}\n${page.publishedAt ? `yayın: ${page.publishedAt.slice(0, 10)}\n` : ""}\n${page.content}`
            : `### (okunamadı)\n${url}`
        )
        .join("\n\n---\n\n");

      return {
        text,
        credits: CREDITS.extractBase + CREDITS.extractPerUrl * pages.filter((p) => p.page).length,
      };
    },
  },

  {
    name: "clouda_answer",
    description:
      "Soruyu arar ve yalnızca kaynaklardan birebir alıntılarla, atıflı bir cevap kurar. " +
      "Hiçbir cümle üretilmez; her cümlenin kaynağı vardır. Doğrulanabilir cevap gerektiğinde kullan.",
    capability: "citations",
    estimate: CREDITS.search + CREDITS.citations,
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        max_sources: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["question"],
    },
    async run(args, ctx) {
      const question = str(args, "question");
      const result = await searchWeb(question, {
        maxResults: num(args, "max_sources", 6, 1, 12),
        includeContent: true,
        domainPolicy: ctx.policy,
      });

      if (result.results.length === 0) {
        return { text: "Bu soru için kaynak bulunamadı.", credits: CREDITS.searchNoContent };
      }

      // Same floor the REST answer endpoint uses: a weakly supported sentence
      // still reads as fact in a model's context, and is not one.
      const claims = verifyClaims(result.results, { query: question }).claims
        .filter((claim) => claim.confidence >= 0.35)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);

      const body =
        claims.length === 0
          ? [
              "Kaynaklarda bu soruya iyi desteklenen doğrudan bir yanıt bulunamadı.",
              "",
              "Bulunan kaynaklar:",
              ...result.results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`),
            ].join("\n")
          : [
              ...claims.map(
                (claim, i) =>
                  `${i + 1}. ${claim.text}\n   güven ${claim.confidence}, ` +
                  `${claim.independentSources} bağımsız kaynak\n` +
                  claim.citations.map((c) => `   → ${c.url}`).join("\n")
              ),
              "",
              "Her cümle kaynağından birebir alıntıdır; hiçbiri üretilmemiştir.",
            ].join("\n");

      return {
        text: body,
        credits: (result.cacheHit ? 0 : CREDITS.search) + CREDITS.citations,
      };
    },
  },

  {
    name: "clouda_rerank",
    description:
      "Kendi belgelerini bir sorguya göre sıralar. Ağ kullanmaz, milisaniyede döner. " +
      "Vektör aramandan çıkan 50 pasajdan prompt'a girecek 5'ini seçmek için.",
    estimate: CREDITS.rerank,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        documents: {
          type: "array",
          items: { type: "string" },
          description: "Sıralanacak metinler.",
        },
        top_k: { type: "integer", minimum: 1, maximum: 50 },
        diversity: { type: "number", description: "0 saf ilgililik, 1 saf çeşitlilik." },
      },
      required: ["query", "documents"],
    },
    async run(args) {
      const documents = Array.isArray(args.documents)
        ? (args.documents as unknown[])
            .filter((d): d is string => typeof d === "string")
            .slice(0, 200)
            .map((text, i) => ({ id: String(i), text }))
        : [];
      if (documents.length === 0) {
        throw new CloudaError("invalid_request", "'documents' en az bir metin içermeli.");
      }

      const ranked = rank(str(args, "query"), documents, {
        topK: num(args, "top_k", Math.min(5, documents.length), 1, 50),
        diversity: Math.min(1, Math.max(0, Number(args.diversity ?? 0) || 0)),
      });

      return {
        text: ranked
          .map(
            (r, i) =>
              `${i + 1}. [belge ${r.id}] skor ${r.score} (görece ${r.relative})\n   ${r.bestPassage ?? ""}`
          )
          .join("\n"),
        credits: CREDITS.rerank,
      };
    },
  },

  {
    name: "clouda_chunk",
    description:
      "Uzun metni, başlık yapısını koruyarak modele verilebilir parçalara böler. " +
      "Ağ kullanmaz. clouda_extract çıktısını RAG'a hazırlamak için.",
    estimate: CREDITS.chunk,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        size: { type: "integer", minimum: 200, maximum: 8000 },
        overlap: { type: "integer", minimum: 0 },
      },
      required: ["text"],
    },
    async run(args) {
      const chunks = chunkText(str(args, "text"), {
        size: num(args, "size", 1200, 200, 8000),
        overlap: num(args, "overlap", 120, 0, 4000),
        includeHeadings: true,
      });

      return {
        text: chunks
          .map((c) => `--- parça ${c.index + 1}/${chunks.length} (~${c.estimatedTokens} token)\n${c.text}`)
          .join("\n\n"),
        credits: CREDITS.chunk,
      };
    },
  },
];

MCP_TOOLS.push({
  name: "clouda_data",
  description:
    "Canlı veriyi sayı olarak getirir: hava durumu, döviz kuru, kripto ve hisse fiyatı, " +
    "deprem, ülke bilgisi, ekonomik gösterge. Bunları aramayla sorma — arama, yazıldığı " +
    "tarihteki rakamı içeren bir makale döndürür ve o rakam güncel değildir. Yanıt, " +
    "değerin ölçüldüğü zaman damgasıyla birlikte gelir.",
  estimate: CREDITS.data,
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: DATA_KINDS, description: "Hangi veri türü." },
      place: { type: "string", description: "weather için şehir adı." },
      base: { type: "string", description: "fx için baz para birimi, örn. USD." },
      symbols: { type: "array", items: { type: "string" }, description: "fx için hedef kurlar." },
      ids: { type: "array", items: { type: "string" }, description: "crypto için coingecko id'leri." },
      currencies: { type: "array", items: { type: "string" }, description: "crypto için para birimleri." },
      symbol: { type: "string", description: "stock için sembol, örn. AAPL, THYAO.IS." },
      min_magnitude: { type: "number", description: "earthquakes için alt eşik." },
      hours: { type: "integer", description: "earthquakes için geriye dönük saat." },
      name: { type: "string", description: "country için ülke adı." },
      country: { type: "string", description: "indicator için ülke kodu, örn. TR." },
      indicator: { type: "string", enum: INDICATOR_NAMES, description: "indicator için seri." },
    },
    required: ["kind"],
  },
  async run(args) {
    const kind = String(args.kind ?? "") as DataKind;
    if (!DATA_KINDS.includes(kind)) {
      throw new CloudaError("invalid_request", `'kind' şunlardan biri olmalı: ${DATA_KINDS.join(", ")}`);
    }

    const strings = (key: string): string[] | undefined =>
      Array.isArray(args[key])
        ? (args[key] as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;

    const result = await fetchLiveData({
      kind,
      place: str(args, "place", false) || undefined,
      base: str(args, "base", false) || undefined,
      symbols: strings("symbols")?.map((s) => s.toUpperCase()),
      ids: strings("ids"),
      currencies: strings("currencies"),
      symbol: str(args, "symbol", false) || undefined,
      minMagnitude: args.min_magnitude == null ? undefined : Number(args.min_magnitude),
      hours: args.hours == null ? undefined : num(args, "hours", 24, 1, 168),
      name: str(args, "name", false) || undefined,
      countryCode: str(args, "country", false) || undefined,
      indicator: str(args, "indicator", false) || undefined,
    });

    // The timestamps lead, because they are the point: a model that cannot see
    // how old a number is will state a stale one as current.
    const header =
      `${result.kind} — kaynak: ${result.source}\n` +
      `ölçüm zamanı: ${result.observedAt ?? "kaynak belirtmiyor"}\n` +
      `getirilme zamanı: ${result.retrievedAt}` +
      (result.ageSeconds != null ? ` (önbellekten, ${result.ageSeconds} sn önce)` : "");

    return {
      text: `${header}\n\n${JSON.stringify(result.data, null, 2)}`,
      credits: CREDITS.data,
    };
  },
});

MCP_TOOLS.push({
  name: "clouda_map",
  description:
    "Bir sitenin yayımladığı bütün adresleri, sitenin kendi site haritasından çıkarır. " +
    "Bir dokümantasyonu baştan sona okuman gerektiğinde önce bunu çağır, sonra çıkan " +
    "adresleri clouda_extract'e ver. Taramaya göre çok daha hızlı ve siteye çok daha kibar.",
  estimate: CREDITS.map,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Site adresi ya da alan adı." },
      path: { type: "string", description: "Yalnızca bu yolu içeren adresler, örn. /docs/." },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
    },
    required: ["url"],
  },
  async run(args, ctx) {
    const result = await mapSite(str(args, "url"), {
      limit: num(args, "limit", 100, 1, 1000),
      pathPrefix: str(args, "path", false) || undefined,
      policy: ctx.policy,
    });

    if (result.urls.length === 0) {
      return { text: `${result.site} için site haritası bulunamadı.`, credits: CREDITS.map };
    }

    const header =
      `${result.site} — ${result.urls.length} adres ` +
      `(${result.urls[0].via === "sitemap" ? "site haritasından" : "ana sayfa bağlantılarından"})` +
      (result.truncated ? ", liste kesildi" : "");

    return {
      text: `${header}\n\n${result.urls
        .map((u) => (u.lastModified ? `${u.url}  [${u.lastModified.slice(0, 10)}]` : u.url))
        .join("\n")}`,
      credits: CREDITS.map,
    };
  },
});

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
