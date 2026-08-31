import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseFreshness, parseLocale, parseInt_ } from "@/lib/api/shapes";
import { runResearch } from "@/lib/research/orchestrator";
import { prisma } from "@/lib/prisma";
import { CREDITS, RESEARCH_DEPTHS, type ResearchDepth } from "@/lib/constants";
import { CloudaError, toCloudaError } from "@/lib/core/errors";

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
 * POST /api/v1/research — deep research. Requires the "research" capability.
 * The run is recorded so a caller can audit what a report was built from.
 */
export const POST = withApi(
  {
    operation: "research",
    capability: "research",
    // Worst case: the base fee plus a search for every planned round.
    estimateCredits: CREDITS.researchBase + CREDITS.researchPerSearch * 8,
  },
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

    const run = await prisma.researchRun.create({
      data: { userId: ctx.userId, apiKeyId: ctx.apiKeyId, question, depth },
    });

    try {
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

      const creditsUsed =
        CREDITS.researchBase + CREDITS.researchPerSearch * report.stats.searches;

      await prisma.researchRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          report: report as never,
          sourcesCount: report.stats.sourcesExamined,
          searchCount: report.stats.searches,
          creditsUsed,
          finishedAt: new Date(),
        },
      });

      return {
        body: {
          research_id: run.id,
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
        creditsUsed,
        resultCount: report.stats.sourcesExamined,
        provider: "research",
        label: question,
      };
    } catch (err) {
      const error = toCloudaError(err);
      await prisma.researchRun
        .update({
          where: { id: run.id },
          data: { status: "failed", errorCode: error.code, finishedAt: new Date() },
        })
        .catch(() => {});
      throw error;
    }
  }
);
