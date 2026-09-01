import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseLocale, parseInt_ } from "@/lib/api/shapes";
import { searchWeb } from "@/lib/search/engine";
import { verifyClaims } from "@/lib/research/citations";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AnswerBody {
  query?: string;
  question?: string;
  max_sources?: number;
  max_sentences?: number;
  locale?: string;
  freshness?: string | number;
}

/** Sentences below this confidence are not worth putting in an answer. */
const MIN_CONFIDENCE = 0.35;

/**
 * POST /api/v1/answer — one call from a question to a cited answer.
 *
 * An agent asking a question usually wants the answer, not a result list it
 * then has to fetch, read and reconcile itself. This does that round trip
 * server-side: search, extract, group the sentences several independent
 * sources state alike, and return them ranked by how well they are supported.
 *
 * The answer is extractive on purpose. Every sentence returned is quoted
 * verbatim from a source and carries the URL it came from, so nothing here can
 * be a fabrication — the failure mode is an unhelpful answer, never an
 * invented one. Where sources disagree the disagreement is returned rather
 * than resolved: picking a winner is the caller's judgement, not ours.
 */
export const POST = withApi(
  {
    operation: "answer",
    capability: "citations",
    estimateCredits: CREDITS.search + CREDITS.citations,
  },
  async (req: NextRequest, ctx) => {
    const body = await readJson<AnswerBody>(req);
    const query = (body.query ?? body.question)?.trim();
    if (!query) {
      throw new CloudaError("invalid_request", "Gövde bir 'query' alanı içermeli.");
    }

    const maxSentences = parseInt_(body.max_sentences, 1, 10, 4);

    const result = await searchWeb(query, {
      maxResults: parseInt_(body.max_sources, 3, 15, 8),
      locale: parseLocale(body.locale),
      freshnessHours: parseFreshness(body.freshness),
      includeContent: true,
      domainPolicy: ctx.policy,
    });

    if (result.results.length === 0) {
      return {
        body: {
          query: result.query,
          answered: false,
          reason: "no_sources",
          answer: [],
          sources: [],
          ...(result.degraded.length > 0 ? { degraded_providers: result.degraded } : {}),
        },
        creditsUsed: CREDITS.searchNoContent,
        resultCount: 0,
        label: query,
      };
    }

    const verification = verifyClaims(result.results, { query });

    // Best-supported first, and only what clears the confidence floor: a
    // weakly-backed sentence in an answer still reads as fact, and is not one.
    const answer = verification.claims
      .filter((claim) => claim.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSentences)
      .map((claim) => ({
        text: claim.text,
        confidence: claim.confidence,
        independent_sources: claim.independentSources,
        basis: claim.basis,
        citations: claim.citations.map((c) => ({
          url: c.url,
          title: c.title,
          quote: c.quote,
          credibility: c.credibility,
          published_at: c.publishedAt,
        })),
        ...(claim.conflicts.length > 0
          ? { conflicts: claim.conflicts.map((c) => ({ url: c.url, quote: c.quote })) }
          : {}),
      }));

    return {
      body: {
        query: result.query,
        // An honest "no" beats a confident guess. The sources are returned
        // either way so the caller can read them itself.
        answered: answer.length > 0,
        ...(answer.length === 0 ? { reason: "no_well_supported_claim" } : {}),
        answer,
        contested: verification.contested.length,
        sources: result.results.map((r) => ({
          title: r.title,
          url: r.url,
          published_at: r.publishedAt,
          credibility: r.scores.credibility,
        })),
        cached: result.cacheHit,
        ...(result.degraded.length > 0 ? { degraded_providers: result.degraded } : {}),
      },
      creditsUsed: result.cacheHit ? CREDITS.citations : CREDITS.search + CREDITS.citations,
      resultCount: answer.length,
      provider: result.provider,
      cacheHit: result.cacheHit,
      label: query,
    };
  }
);
