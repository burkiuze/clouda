import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseLocale, parseInt_, shapeResult } from "@/lib/api/shapes";
import { searchWeb } from "@/lib/search/engine";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BatchBody {
  queries?: unknown;
  max_results?: number;
  locale?: string;
  freshness?: string | number;
  include_content?: boolean;
  no_cache?: boolean;
}

/** Ceiling on one batch. Beyond this the fan-out competes with itself. */
const MAX_QUERIES = 10;

/**
 * POST /api/v1/search/batch — several questions, one round trip.
 *
 * An agent decomposing a task issues five or six searches at once, and over
 * HTTP that is five or six connections, five or six authentications and five
 * or six credit reservations, serialised by whatever client library it uses.
 * Here they share all of that and run concurrently against the same provider
 * pool, so a batch of five costs roughly what the slowest of the five costs.
 *
 * Billing is unchanged: each query is priced exactly as it would be alone, a
 * cached one is free, and one failing query does not fail or charge for the
 * rest — it comes back with its own error inside the batch.
 */
export const POST = withApi(
  { operation: "search", estimateCredits: CREDITS.search * MAX_QUERIES },
  async (req: NextRequest, ctx) => {
    const body = await readJson<BatchBody>(req);

    if (!Array.isArray(body.queries) || body.queries.length === 0) {
      throw new CloudaError("invalid_request", "Gövde bir 'queries' dizisi içermeli.");
    }
    if (body.queries.length > MAX_QUERIES) {
      throw new CloudaError(
        "invalid_request",
        `Tek istekte en fazla ${MAX_QUERIES} sorgu gönderilebilir.`
      );
    }

    const queries = body.queries.map((q) => {
      if (typeof q !== "string" || !q.trim()) {
        throw new CloudaError("invalid_request", "'queries' yalnızca boş olmayan metinler içerebilir.");
      }
      return q.trim();
    });

    const seen = new Set<string>();
    for (const q of queries) {
      const key = q.toLowerCase();
      if (seen.has(key)) {
        throw new CloudaError("invalid_request", `Aynı sorgu iki kez gönderilmiş: ${q}`);
      }
      seen.add(key);
    }

    const options = {
      maxResults: parseInt_(body.max_results, 1, 30, 10),
      locale: parseLocale(body.locale),
      freshnessHours: parseFreshness(body.freshness),
      includeContent: body.include_content !== false,
      noCache: body.no_cache === true,
      domainPolicy: ctx.policy,
    };

    const answers = await Promise.all(
      queries.map(async (query) => {
        try {
          const result = await searchWeb(query, options);
          const cost = result.cacheHit
            ? 0
            : options.includeContent
              ? CREDITS.search
              : CREDITS.searchNoContent;

          return {
            cost,
            count: result.results.length,
            providers: result.provider,
            payload: {
              query: result.query,
              intent: result.plan.intent,
              cached: result.cacheHit,
              results: result.results.map((r) => shapeResult(r, "results")),
              provider: result.provider,
              ...(result.degraded.length > 0 ? { degraded_providers: result.degraded } : {}),
            },
          };
        } catch (err) {
          // One bad query in a batch is a result, not an outage: the other
          // queries have already been paid for and answered.
          const error = err instanceof CloudaError ? err : null;
          return {
            cost: 0,
            count: 0,
            providers: null,
            payload: {
              query,
              error: {
                code: error?.code ?? "internal_error",
                message: error?.message ?? "Sorgu tamamlanamadı.",
              },
            },
          };
        }
      })
    );

    const providers = [
      ...new Set(answers.flatMap((a) => (a.providers ? a.providers.split("+") : []))),
    ].join("+");

    return {
      body: {
        count: answers.length,
        succeeded: answers.filter((a) => !("error" in a.payload)).length,
        searches: answers.map((a) => a.payload),
      },
      creditsUsed: answers.reduce((sum, a) => sum + a.cost, 0),
      resultCount: answers.reduce((sum, a) => sum + a.count, 0),
      provider: providers || "none",
      cacheHit: answers.every((a) => a.cost === 0),
      steps: answers.length,
      label: `batch:${queries.length}`,
    };
  }
);
