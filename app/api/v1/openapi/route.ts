import { CLOUDA_RELEASE } from "@/lib/version";
import { NextRequest, NextResponse } from "next/server";
import { NEWS_FEED_COUNT, TOTAL_SOURCE_COUNT } from "@/lib/constants";
import { DATA_KINDS, INDICATOR_NAMES } from "@/lib/data/live";

export const dynamic = "force-dynamic";

/**
 * The API, described in a format a machine can read.
 *
 * Documentation prose is for people. An agent framework, a code generator or a
 * client library wants the shapes, and hand-writing an integration against
 * prose is how parameter names get guessed wrong. This is generated from the
 * same constants the routes charge against, so the prices here cannot drift
 * from the prices actually billed.
 */

const BEARER = [{ bearerAuth: [] }];

/** Fields every successful response carries, from the gateway rather than the route. */
const ENVELOPE = {
  took_ms: { type: "integer", description: "Sunucu tarafında geçen süre." },
};

function jsonBody(schema: Record<string, unknown>, required: string[] = []) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties: schema, ...(required.length ? { required } : {}) },
      },
    },
  };
}

function ok(properties: Record<string, unknown>) {
  return {
    "200": {
      description: "Başarılı",
      content: {
        "application/json": {
          schema: { type: "object", properties: { ...properties, ...ENVELOPE } },
        },
      },
    },
  };
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    url: { type: "string", format: "uri" },
    snippet: { type: "string" },
    content: { type: "string", description: "Sayfadan çıkarılan okunabilir metin." },
    published_at: { type: "string", format: "date-time", nullable: true },
    updated_at: { type: "string", format: "date-time", nullable: true },
    source: { type: "string", description: "Bu sonucu getiren kaynakların birleşimi." },
    scores: {
      type: "object",
      properties: {
        relevance: { type: "number", minimum: 0, maximum: 1 },
        credibility: { type: "number", minimum: 0, maximum: 1 },
        freshness: { type: "number", minimum: 0, maximum: 1 },
        overall: { type: "number", minimum: 0, maximum: 1 },
        signals: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export async function GET(req: NextRequest) {
  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: CLOUDA_RELEASE.name,
      version: CLOUDA_RELEASE.version,
      summary: "Yapay zeka modelleri ve ajanları için canlı web erişimi.",
      description:
        "Arama, haber, içerik çıkarımı, kaynaklı cevap, canlı veri, site haritası, " +
        "yeniden sıralama ve parçalama. Yerel çalıştırmada kimlik doğrulama " +
        "gerekmez; CLOUDA_TOKEN tanımlarsan her uç 'Authorization: Bearer <token>' " +
        `ister. Aynı yetenekler MCP üzerinden de sunulur: ${base}/api/mcp`,
      contact: { url: base },
    },
    servers: [{ url: base }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "CLOUDA_TOKEN" },
      },
      schemas: { SearchResult: RESULT_SCHEMA },
      responses: {
        Error: {
          description: "Hata",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string", description: "Makine tarafından okunan hata kodu." },
                  message: { type: "string" },
                  details: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    security: [],
    "x-sources": { endpoints: TOTAL_SOURCE_COUNT, news_feeds: NEWS_FEED_COUNT },
    paths: {
      "/api/v1/search": {
        post: {
          operationId: "search",
          summary: "Web araması, içerik çıkarımı ve kalite skorları",
          requestBody: jsonBody(
            {
              query: { type: "string" },
              search_depth: { type: "string", enum: ["fast", "balanced", "deep"], default: "balanced" },
              max_results: { type: "integer", minimum: 1, maximum: 30, default: 10 },
              locale: { type: "string", default: "tr-TR" },
              freshness: {
                oneOf: [{ type: "string", enum: ["hour", "day", "week", "month", "year"] }, { type: "number", exclusiveMinimum: 0 }],
              },
              include_content: { type: "boolean", default: true },
              no_cache: { type: "boolean", default: false },
              include_onion: {
                type: "boolean",
                default: false,
                description:
                  "Tor onion servislerini de ara. Sunucuda etkinleştirilmemişse yok sayılır; " +
                  "sayfa metni yalnızca sunucuda Tor tanımlıysa çıkarılır.",
              },
              mode: { type: "string", enum: ["results", "sources", "claims"], default: "results" },
              include_domains: { type: "array", items: { type: "string" } },
              exclude_domains: { type: "array", items: { type: "string" } },
            },
            ["query"]
          ),
          responses: {
            ...ok({
              query: { type: "string" },
              intent: { type: "string" },
              provider: { type: "string" },
              cached: { type: "boolean" },
              diagnostics: { type: "object", properties: {
                depth: { type: "string", enum: ["fast", "balanced", "deep"] },
                providersQueried: { type: "integer", description: "Dispatched provider tasks, including shared work; not HTTP request count." },
                providersWithResults: { type: "integer" }, candidates: { type: "integer" },
                pageFetches: { type: "integer" }, resultHosts: { type: "integer" },
              } },
              results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
              degraded_providers: {
                type: "array",
                description: "Yanıt vermeyen kaynaklar ve nedenleri.",
                items: {
                  type: "object",
                  properties: { provider: { type: "string" }, reason: { type: "string" } },
                },
              },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/search/batch": {
        post: {
          operationId: "searchBatch",
          summary: "Tek istekte 10 sorguya kadar paralel arama",
          requestBody: jsonBody(
            {
              queries: { type: "array", items: { type: "string" }, maxItems: 10 },
              search_depth: { type: "string", enum: ["fast", "balanced", "deep"], default: "balanced" },
              max_results: { type: "integer", minimum: 1, maximum: 30 },
              include_content: { type: "boolean" },
              include_domains: { type: "array", items: { type: "string" } },
              exclude_domains: { type: "array", items: { type: "string" } },
            },
            ["queries"]
          ),
          responses: {
            ...ok({
              count: { type: "integer" },
              succeeded: { type: "integer" },
              searches: { type: "array", items: { type: "object", additionalProperties: true } },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/news": {
        post: {
          operationId: "news",
          summary: "Yayıncı beslemelerinden canlı haber",
          description:
            "Sorgu opsiyoneldir; boş bırakılırsa en son manşetler döner. Adresler gerçek " +
            "makale adresleridir, dolayısıyla okunabilirler.",
          requestBody: jsonBody({
            query: { type: "string", description: "Opsiyonel." },
            lang: { type: "string", enum: ["tr", "en"] },
            topics: {
              type: "array",
              items: { type: "string", enum: ["general", "business", "tech", "science", "world"] },
            },
            sources: { type: "array", items: { type: "string" } },
            freshness: { oneOf: [{ type: "string" }, { type: "integer" }] },
            max_results: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            include_content: { type: "boolean", default: false },
          }),
          responses: {
            ...ok({
              corpus_size: { type: "integer" },
              articles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    url: { type: "string", format: "uri" },
                    snippet: { type: "string" },
                    published_at: { type: "string", format: "date-time" },
                    publisher: { type: "string" },
                    lang: { type: "string" },
                  },
                },
              },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/data": {
        post: {
          operationId: "liveData",
          summary: "Canlı veri: hava, kur, kripto, hisse, deprem, ülke, gösterge",
          description:
            "Bunları aramayla sorma: arama, yazıldığı tarihteki rakamı içeren bir makale " +
            "döndürür. Yanıt hem ölçüm zamanını hem getirilme zamanını taşır — ikisi aynı " +
            "şey değildir.",
          requestBody: jsonBody(
            {
              kind: { type: "string", enum: DATA_KINDS },
              place: { type: "string", description: "weather için şehir." },
              days: { type: "integer", minimum: 1, maximum: 7 },
              base: { type: "string", description: "fx için baz para birimi." },
              symbols: { type: "array", items: { type: "string" } },
              ids: { type: "array", items: { type: "string" }, description: "crypto id'leri." },
              currencies: { type: "array", items: { type: "string" } },
              symbol: { type: "string", description: "stock sembolü." },
              min_magnitude: { type: "number" },
              hours: { type: "integer", minimum: 1, maximum: 168 },
              name: { type: "string", description: "country için ülke adı." },
              country: { type: "string", description: "indicator için ülke kodu." },
              indicator: { type: "string", enum: INDICATOR_NAMES },
              years: { type: "integer", minimum: 1, maximum: 60 },
            },
            ["kind"]
          ),
          responses: {
            ...ok({
              kind: { type: "string" },
              source: { type: "string" },
              observed_at: {
                type: "string",
                nullable: true,
                description: "Değerin ölçüldüğü an. Getirilme anıyla aynı değildir.",
              },
              retrieved_at: { type: "string", format: "date-time" },
              cached: { type: "boolean" },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/map": {
        post: {
          operationId: "mapSite",
          summary: "Bir sitenin yayımladığı bütün adresler",
          description: "Sitenin kendi site haritasından okunur, taranmaz.",
          requestBody: jsonBody(
            {
              url: { type: "string" },
              path: { type: "string", description: "Yalnızca bu yolu içeren adresler." },
              limit: { type: "integer", minimum: 1, maximum: 5000, default: 200 },
            },
            ["url"]
          ),
          responses: {
            ...ok({
              site: { type: "string" },
              count: { type: "integer" },
              truncated: { type: "boolean" },
              urls: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    last_modified: { type: "string", nullable: true },
                    via: { type: "string", enum: ["sitemap", "links"] },
                  },
                },
              },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/extract": {
        post: {
          operationId: "extract",
          summary: "Adresleri modele hazır metne çevirir",
          requestBody: jsonBody({ urls: { type: "array", items: { type: "string" } } }, ["urls"]),
          responses: {
            ...ok({ pages: { type: "array", items: { type: "object", additionalProperties: true } } }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/answer": {
        post: {
          operationId: "answer",
          summary: "Kaynaklı, alıntıya dayalı cevap",
          description:
            "Her cümle kaynağından birebir alıntıdır; hiçbiri üretilmez.",
          requestBody: jsonBody(
            {
              query: { type: "string" },
              max_sources: { type: "integer", minimum: 3, maximum: 15 },
              max_sentences: { type: "integer", minimum: 1, maximum: 10 },
            },
            ["query"]
          ),
          responses: {
            ...ok({
              answered: { type: "boolean" },
              answer: { type: "array", items: { type: "object", additionalProperties: true } },
              sources: { type: "array", items: { type: "object", additionalProperties: true } },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/rerank": {
        post: {
          operationId: "rerank",
          summary: "Kendi belgelerini bir sorguya göre sıralar",
          description: "Ağ kullanmaz, milisaniyede döner.",
          requestBody: jsonBody(
            {
              query: { type: "string" },
              documents: {
                type: "array",
                maxItems: 200,
                items: {
                  oneOf: [
                    { type: "string" },
                    {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        text: { type: "string" },
                        metadata: { type: "object", additionalProperties: true },
                      },
                      required: ["text"],
                    },
                  ],
                },
              },
              top_k: { type: "integer", minimum: 1, maximum: 200 },
              diversity: { type: "number", minimum: 0, maximum: 1, default: 0 },
            },
            ["query", "documents"]
          ),
          responses: {
            ...ok({
              scored: { type: "integer" },
              rank_ms: { type: "integer" },
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    position: { type: "integer" },
                    id: { type: "string" },
                    score: { type: "number" },
                    relative: { type: "number" },
                    matched_terms: { type: "array", items: { type: "string" } },
                    best_passage: { type: "string", nullable: true },
                  },
                },
              },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/chunk": {
        post: {
          operationId: "chunk",
          summary: "Uzun metni başlık yapısını koruyarak parçalara böler",
          description: "Ağ kullanmaz.",
          requestBody: jsonBody(
            {
              text: { type: "string" },
              size: { type: "integer", minimum: 200, maximum: 8000, default: 1200 },
              overlap: { type: "integer", minimum: 0, default: 120 },
              include_headings: { type: "boolean", default: false },
            },
            ["text"]
          ),
          responses: {
            ...ok({
              chunks: { type: "integer" },
              estimated_tokens: { type: "integer" },
              results: { type: "array", items: { type: "object", additionalProperties: true } },
            }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/research": {
        post: {
          operationId: "research",
          summary: "Çok turlu araştırma, kaynaklı rapor",
          requestBody: jsonBody(
            {
              question: { type: "string" },
              depth: { type: "string", enum: ["quick", "standard", "deep"] },
            },
            ["question"]
          ),
          responses: {
            ...ok({ report: { type: "object", additionalProperties: true } }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/browse": {
        post: {
          operationId: "browse",
          summary: "Sayfa açar, bağlantı takip eder",
          requestBody: jsonBody({ url: { type: "string" }, goal: { type: "string" } }, ["url"]),
          responses: {
            ...ok({ steps: { type: "array", items: { type: "object", additionalProperties: true } } }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/v1/social": {
        post: {
          operationId: "social",
          summary: "Mastodon, Lemmy ve YouTube araması",
          requestBody: jsonBody({ query: { type: "string" } }, ["query"]),
          responses: {
            ...ok({ results: { type: "array", items: { type: "object", additionalProperties: true } } }),
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },

      "/api/health": {
        get: {
          operationId: "health",
          summary: "Bağımlılıkların ve kaynakların durumu",
          security: [],
          responses: {
            ...ok({
              ready: { type: "boolean" },
              checks: { type: "object", additionalProperties: true },
              sources: { type: "object", additionalProperties: true },
            }),
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
