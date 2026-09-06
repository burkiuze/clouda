import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { rank, RankDocument } from "@/lib/rank/bm25";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RerankBody {
  query?: string;
  documents?: unknown;
  top_k?: number;
  diversity?: number;
  passage_chars?: number;
}

/** Enough to rerank a generous retrieval set without becoming a batch job. */
const MAX_DOCUMENTS = 200;
const MAX_DOC_CHARS = 40_000;
const MAX_TOTAL_CHARS = 1_500_000;

function parseDocuments(value: unknown): RankDocument[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CloudaError("invalid_request", "Gövde boş olmayan bir 'documents' dizisi içermeli.");
  }
  if (value.length > MAX_DOCUMENTS) {
    throw new CloudaError(
      "invalid_request",
      `Tek istekte en fazla ${MAX_DOCUMENTS} belge sıralanabilir.`
    );
  }

  let total = 0;
  const seen = new Set<string>();

  return value.map((raw, index) => {
    // A bare string is the shape a caller reaches for first, so it is accepted
    // and given its position as an id.
    const entry = typeof raw === "string" ? { text: raw } : raw;
    if (!entry || typeof entry !== "object") {
      throw new CloudaError("invalid_request", `documents[${index}] metin ya da nesne olmalı.`);
    }

    const record = entry as Record<string, unknown>;
    const text = record.text ?? record.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new CloudaError("invalid_request", `documents[${index}] boş olmayan bir 'text' içermeli.`);
    }
    if (text.length > MAX_DOC_CHARS) {
      throw new CloudaError(
        "invalid_request",
        `documents[${index}] ${MAX_DOC_CHARS} karakteri aşıyor. Önce /api/v1/chunk kullan.`
      );
    }

    total += text.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new CloudaError("invalid_request", "Belgelerin toplam boyutu çok büyük.");
    }

    const id = typeof record.id === "string" && record.id ? record.id : String(index);
    if (seen.has(id)) {
      throw new CloudaError("invalid_request", `Aynı id iki kez gönderilmiş: ${id}`);
    }
    seen.add(id);

    return {
      id,
      text,
      title: typeof record.title === "string" ? record.title : undefined,
      metadata:
        record.metadata && typeof record.metadata === "object"
          ? (record.metadata as Record<string, unknown>)
          : undefined,
    };
  });
}

/**
 * POST /api/v1/rerank — ranks the caller's own documents against a query.
 *
 * The rest of this API ranks pages we went and got. An agent doing retrieval
 * has the opposite problem: it already has fifty passages out of its vector
 * store and has to choose the five that go in the prompt. Vector similarity is
 * weak at exactly that step — it finds text that is *about* the same subject,
 * which is why it returns a passage on Postgres indexes for a question about
 * one specific error message.
 *
 * No network, no page fetch, no model. It is lexical scoring over text the
 * caller already has, which is why it answers in milliseconds and why it is
 * priced as the cheapest thing here.
 */
export const POST = withApi(
  { operation: "search", estimateCredits: CREDITS.rerank },
  async (req: NextRequest) => {
    const body = await readJson<RerankBody>(req);

    const query = body.query?.trim();
    if (!query) throw new CloudaError("invalid_request", "Gövde bir 'query' alanı içermeli.");
    if (query.length > 1000) throw new CloudaError("query_too_long", "Sorgu 1000 karakteri aşamaz.");

    const documents = parseDocuments(body.documents);

    const diversity = body.diversity == null ? 0 : Number(body.diversity);
    if (!Number.isFinite(diversity) || diversity < 0 || diversity > 1) {
      throw new CloudaError("invalid_request", "'diversity' 0 ile 1 arasında olmalı.");
    }

    const started = Date.now();
    const ranked = rank(query, documents, {
      topK: parseInt_(body.top_k, 1, MAX_DOCUMENTS, Math.min(10, documents.length)),
      diversity,
      passageChars: parseInt_(body.passage_chars, 80, 2000, 320),
    });

    return {
      body: {
        query,
        scored: documents.length,
        returned: ranked.length,
        diversity,
        rank_ms: Date.now() - started,
        results: ranked.map((r, position) => ({
          position,
          id: r.id,
          score: r.score,
          relative: r.relative,
          matched_terms: r.matchedTerms,
          best_passage: r.bestPassage,
          ...(r.metadata ? { metadata: r.metadata } : {}),
        })),
      },
      creditsUsed: CREDITS.rerank,
      resultCount: ranked.length,
      provider: "local",
      cacheHit: false,
      label: query,
    };
  }
);
