import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseLocale, parseInt_ } from "@/lib/api/shapes";
import { runResearch } from "@/lib/research/orchestrator";
import { RESEARCH_DEPTHS, type ResearchDepth } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ResearchBody {
  question?: string;
  depth?: string;
  max_sources?: number;
  max_duration_ms?: number;
  locale?: string;
  freshness?: string | number;
}

/**
 * POST /api/v1/research — breaks a question into sub-questions, searches each,
 * reads the sources and returns a cited report.
 *
 * Runs used to be written to a table so a caller could audit what a report was
 * built from and what it cost. Nothing costs anything now, and the report
 * carries its own sources and statistics, so the record added a database
 * requirement without adding an answer.
 */
export const POST = withApi(
  { operation: "research" },
  async (req: NextRequest, ctx) => {
    const body = await readJson<ResearchBody>(req);
    const question = body.question?.trim();
    if (!question) {
      throw new CloudaError("invalid_request", "Gövde bir 'question' alanı içermeli.");
    }

    const depth = (body.depth ?? "standard") as ResearchDepth;
    if (!RESEARCH_DEPTHS[depth]) {
      throw new CloudaError(
        "invalid_request",
        `Geçersiz depth: ${depth}. Desteklenenler: ${Object.keys(RESEARCH_DEPTHS).join(", ")}`
      );
    }

    const report = await runResearch(question, {
      depth,
      maxSources: body.max_sources ? parseInt_(body.max_sources, 3, 40, 12) : undefined,
      maxDurationMs: body.max_duration_ms
        ? parseInt_(body.max_duration_ms, 5_000, 120_000, 60_000)
        : undefined,
      locale: parseLocale(body.locale),
      freshnessHours: parseFreshness(body.freshness),
      domainPolicy: ctx.policy,
    });

    return {
      body: {
        question: report.question,
        depth: report.depth,
        plan: report.plan,
        summary: report.summary,
        sections: report.sections,
        key_findings: report.keyFindings,
        conflicts: report.conflicts,
        sources: report.sources,
        gaps: report.gaps,
        stats: report.stats,
      },
      resultCount: report.stats.sourcesExamined,
      provider: "research",
      label: question,
    };
  }
);
