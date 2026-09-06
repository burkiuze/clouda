import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";
import { chunkText } from "@/lib/rank/chunk";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ChunkBody {
  text?: string;
  size?: number;
  overlap?: number;
  include_headings?: boolean;
}

const MAX_TEXT = 1_000_000;

/**
 * POST /api/v1/chunk — splits text into passages a model can be given.
 *
 * Cutting every N characters is why so much retrieval is bad: it splits
 * sentences in half, separates a heading from the paragraph it introduces, and
 * hands the model a fragment with no idea what it belongs to. This splits on
 * the structure the text already has and labels each passage with the headings
 * above it, so a chunk that says "it must be rebuilt concurrently" still knows
 * it is under "Reindexing".
 *
 * Pairs with /api/v1/extract, which turns a URL into text, and
 * /api/v1/rerank, which chooses between the pieces.
 */
export const POST = withApi(
  { operation: "extract", estimateCredits: CREDITS.chunk },
  async (req: NextRequest) => {
    const body = await readJson<ChunkBody>(req);

    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) throw new CloudaError("invalid_request", "Gövde bir 'text' alanı içermeli.");
    if (text.length > MAX_TEXT) {
      throw new CloudaError("invalid_request", `Metin ${MAX_TEXT} karakteri aşamaz.`);
    }

    const size = parseInt_(body.size, 200, 8000, 1200);
    const overlap = parseInt_(body.overlap, 0, Math.floor(size / 2), Math.min(120, Math.floor(size / 2)));

    const started = Date.now();
    const chunks = chunkText(text, {
      size,
      overlap,
      includeHeadings: body.include_headings === true,
    });

    const tokens = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);

    return {
      body: {
        source_chars: text.length,
        chunks: chunks.length,
        estimated_tokens: tokens,
        settings: { size, overlap, include_headings: body.include_headings === true },
        chunk_ms: Date.now() - started,
        results: chunks.map((c) => ({
          index: c.index,
          text: c.text,
          headings: c.headings,
          chars: c.chars,
          estimated_tokens: c.estimatedTokens,
          start: c.start,
          end: c.end,
        })),
      },
      creditsUsed: CREDITS.chunk,
      resultCount: chunks.length,
      provider: "local",
      cacheHit: false,
      label: `chunk:${text.length}`,
    };
  }
);
