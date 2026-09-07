import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import {
  parseSearchDepth,
  parseDomains,
  parseFreshness,
  parseLocale,
  parseInt_,
  parseMode,
  shapeResult,
} from "@/lib/api/shapes";
import { searchWeb } from "@/lib/search/engine";
import { verifyClaims } from "@/lib/research/citations";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SearchBody {
  query?: string;
  max_results?: number;
  locale?: string;
  freshness?: string | number;
  search_depth?: string;
  include_content?: boolean;
  no_cache?: boolean;
  mode?: string;
  include_domains?: string[];
  exclude_domains?: string[];
}

/**
 * POST /api/v1/search — the always-on capability. Every key can call this.
 */
export const POST = withApi(
  { operation: "search" },
  async (req: NextRequest, ctx) => {
    const body = await readJson<SearchBody>(req);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      throw new CloudaError("invalid_request", "Gövde bir 'query' alanı içermeli.");
    }

    // Every mode is available: there are no per-key capabilities to gate them
    // behind when the key is you.
    const mode = parseMode(body.mode, ["results", "sources", "claims"]);

    const result = await searchWeb(query, {
      depth: parseSearchDepth(body.search_depth),
      maxResults: parseInt_(body.max_results, 1, 30, 10),
      locale: parseLocale(body.locale),
      freshnessHours: parseFreshness(body.freshness),
      includeContent: mode === "sources" ? false : body.include_content !== false,
      noCache: body.no_cache === true,
      domainPolicy: ctx.policy,
      domainFilter: {
        include: parseDomains(body.include_domains, "include_domains"),
        exclude: parseDomains(body.exclude_domains, "exclude_domains"),
      },
    });

    const payload: Record<string, unknown> = {
      query: result.query,
      mode,
      intent: result.plan.intent,
      freshness_applied: result.plan.needsFreshness,
      results: result.results.map((r) => shapeResult(r, mode)),
      provider: result.provider,
      cached: result.cacheHit,
      diagnostics: result.diagnostics,
      ...(result.degraded.length > 0 ? { degraded_providers: result.degraded } : {}),
    };

    if (mode === "claims") {
      const verification = verifyClaims(result.results, { query });
      payload.claims = verification.claims;
      payload.contested_claims = verification.contested;
    }

    return {
      body: payload,
      resultCount: result.results.length,
      provider: result.provider,
      cacheHit: result.cacheHit,
      label: query,
    };
  }
);
