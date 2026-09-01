import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseLocale, parseInt_, parseMode, shapeResult } from "@/lib/api/shapes";
import { searchWeb } from "@/lib/search/engine";
import { verifyClaims } from "@/lib/research/citations";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SearchBody {
  query?: string;
  max_results?: number;
  locale?: string;
  freshness?: string | number;
  include_content?: boolean;
  no_cache?: boolean;
  mode?: string;
}

/**
 * POST /api/v1/search — the always-on capability. Every key can call this.
 */
export const POST = withApi(
  { operation: "search", estimateCredits: CREDITS.search },
  async (req: NextRequest, ctx) => {
    const body = await readJson<SearchBody>(req);
    const query = body.query?.trim();
    if (!query) {
      throw new CloudaError("invalid_request", "Gövde bir 'query' alanı içermeli.");
    }

    const mode = parseMode(body.mode, ["results", "sources", "claims"]);
    // Claims mode reads source text, so it is priced with the citations add-on.
    if (mode === "claims" && !ctx.capabilities.includes("citations")) {
      throw new CloudaError(
        "capability_not_enabled",
        'Bu anahtarda "citations" özelliği açık değil. Panelden etkinleştirebilirsin.',
        { capability: "citations" }
      );
    }

    const result = await searchWeb(query, {
      maxResults: parseInt_(body.max_results, 1, 30, 10),
      locale: parseLocale(body.locale),
      freshnessHours: parseFreshness(body.freshness),
      includeContent: mode === "sources" ? false : body.include_content !== false,
      noCache: body.no_cache === true,
      domainPolicy: ctx.policy,
    });

    // A cached answer costs nothing, and a request that declined page content
    // is charged the discovery rate: the price follows the work.
    const extracted = mode !== "sources" && body.include_content !== false;
    const base = result.cacheHit ? 0 : extracted ? CREDITS.search : CREDITS.searchNoContent;
    const creditsUsed = base + (mode === "claims" ? CREDITS.citations : 0);

    const payload: Record<string, unknown> = {
      query: result.query,
      mode,
      intent: result.plan.intent,
      freshness_applied: result.plan.needsFreshness,
      results: result.results.map((r) => shapeResult(r, mode)),
      provider: result.provider,
      cached: result.cacheHit,
      ...(result.degraded.length > 0 ? { degraded_providers: result.degraded } : {}),
    };

    if (mode === "claims") {
      const verification = verifyClaims(result.results, { query });
      payload.claims = verification.claims;
      payload.contested_claims = verification.contested;
    }

    return {
      body: payload,
      creditsUsed,
      resultCount: result.results.length,
      provider: result.provider,
      cacheHit: result.cacheHit,
      label: query,
    };
  }
);
