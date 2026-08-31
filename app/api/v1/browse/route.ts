import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { runBrowserSession, type BrowserAction } from "@/lib/browser/agent";
import { CREDITS } from "@/lib/constants";
import { CloudaError } from "@/lib/core/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface BrowseBody {
  url?: string;
  actions?: BrowserAction[];
  max_steps?: number;
  max_duration_ms?: number;
}

const VALID_ACTIONS = new Set(["open", "follow", "find", "extract", "paginate", "submit"]);

/**
 * POST /api/v1/browse — sandboxed navigation. Requires the "browse"
 * capability. Accepts either a bare `url` for a single fetch, or an `actions`
 * script for multi-step navigation.
 */
export const POST = withApi(
  {
    operation: "browse",
    capability: "browse",
    estimateCredits: CREDITS.browseBase + CREDITS.browsePerStep * 8,
  },
  async (req: NextRequest, ctx) => {
    const body = await readJson<BrowseBody>(req);

    let actions: BrowserAction[];
    if (Array.isArray(body.actions) && body.actions.length > 0) {
      for (const action of body.actions) {
        if (!action || !VALID_ACTIONS.has(action.type)) {
          throw new CloudaError(
            "invalid_request",
            `Geçersiz eylem türü: ${String(action?.type)}. Desteklenenler: ${[...VALID_ACTIONS].join(", ")}`
          );
        }
      }
      actions = body.actions;
    } else if (body.url) {
      actions = [{ type: "open", url: body.url }];
    } else {
      throw new CloudaError("invalid_request", "Gövde bir 'url' ya da 'actions' alanı içermeli.");
    }

    const result = await runBrowserSession(actions, {
      maxSteps: parseInt_(body.max_steps, 1, 20, 8),
      maxDurationMs: body.max_duration_ms
        ? parseInt_(body.max_duration_ms, 5_000, 90_000, 45_000)
        : undefined,
      policy: ctx.policy,
    });

    return {
      body: {
        final_url: result.finalUrl,
        title: result.title,
        content: result.content,
        published_at: result.publishedAt,
        matches: result.matches,
        links: result.links,
        pages_visited: result.pagesVisited,
        trace: result.trace,
        steps: result.steps,
        stopped_reason: result.stoppedReason,
        ...(result.javascriptRequired
          ? {
              warning: "javascript_required",
              warning_detail:
                "Sayfa içeriği istemci tarafında oluşturuluyor; çıkarılan metin eksik olabilir.",
            }
          : {}),
      },
      creditsUsed: CREDITS.browseBase + CREDITS.browsePerStep * result.steps,
      resultCount: result.pagesVisited.length,
      provider: "browser",
      steps: result.steps,
      label: result.finalUrl,
    };
  }
);
