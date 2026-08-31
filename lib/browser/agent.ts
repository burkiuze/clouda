import { CloudaError } from "@/lib/core/errors";
import { safeFetch } from "@/lib/core/http";
import { parsePage, type ExtractedPage } from "@/lib/search/extract";
import { normalize } from "@/lib/search/query";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * Browser agent.
 *
 * A bounded navigation session: open a page, follow links, page through
 * listings, search within a page, submit GET forms. Each step is validated
 * against the same SSRF and domain policy as everything else, counted against
 * a step limit, and written into a trace the caller gets back.
 *
 * What it deliberately does not do: execute JavaScript, or submit anything
 * that changes state. There is no headless browser behind it, so a page whose
 * content only exists after client-side rendering will come back thin — the
 * response says so via `javascript_required` rather than pretending. POST
 * submissions are refused outright: an autonomous agent should not be able to
 * make a purchase or post a message through this API.
 */

export type ActionType = "open" | "follow" | "find" | "extract" | "paginate" | "submit";

export interface BrowserAction {
  type: ActionType;
  /** open/submit: the target URL. */
  url?: string;
  /** follow: link text to match, case-insensitive substring. */
  linkText?: string;
  /** find: text to locate in the current page. */
  query?: string;
  /** submit: query-string fields appended to the URL (GET only). */
  fields?: Record<string, string>;
  /** paginate: how many "next" pages to walk. */
  pages?: number;
}

export interface StepTrace {
  step: number;
  action: ActionType;
  url: string;
  status: "ok" | "failed";
  detail: string;
  tookMs: number;
}

export interface BrowseResult {
  finalUrl: string;
  title: string;
  content: string;
  publishedAt: string | null;
  /** Matches when a `find` action ran. */
  matches: { text: string; context: string }[];
  links: { text: string; url: string }[];
  pagesVisited: string[];
  trace: StepTrace[];
  steps: number;
  javascriptRequired: boolean;
  stoppedReason: "completed" | "step_limit" | "time_limit";
}

export interface BrowseOptions {
  maxSteps?: number;
  maxDurationMs?: number;
  policy?: DomainPolicy;
}

const DEFAULT_MAX_STEPS = 8;
const HARD_MAX_STEPS = 20;
const DEFAULT_MAX_DURATION = 45_000;

/** Link labels that advance a listing, in both languages the product serves. */
const NEXT_PATTERNS = [
  /^\s*(sonraki|ileri|devam)\s*$/i,
  /^\s*(next|more|older)\s*(page|›|»|>)?\s*$/i,
  /^\s*(›|»|>|→)\s*$/,
];

function looksJavaScriptOnly(page: ExtractedPage): boolean {
  return (
    page.content.length < 250 &&
    /(enable javascript|javascript'i etkinleştir|requires javascript|noscript)/i.test(page.content)
  );
}

async function loadPage(url: string, policy?: DomainPolicy): Promise<ExtractedPage> {
  const res = await safeFetch(url, {
    policy,
    timeoutMs: 8000,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });

  if (!res.contentType.includes("html") && !res.contentType.includes("text/plain")) {
    throw new CloudaError(
      "unsupported_content_type",
      `Bu içerik türü gezinilemiyor: ${res.contentType || "bilinmiyor"}`,
      { url, contentType: res.contentType }
    );
  }
  return parsePage(res);
}

function findInPage(page: ExtractedPage, query: string) {
  const needle = normalize(query);
  if (!needle) return [];

  const matches: { text: string; context: string }[] = [];
  for (const line of page.content.split("\n")) {
    if (matches.length >= 10) break;
    if (normalize(line).includes(needle)) {
      matches.push({ text: query, context: line.slice(0, 400) });
    }
  }
  return matches;
}

function resolveLink(page: ExtractedPage, linkText: string): string | null {
  const needle = normalize(linkText);
  const exact = page.links.find((l) => normalize(l.text) === needle);
  if (exact) return exact.url;
  const partial = page.links.find((l) => normalize(l.text).includes(needle));
  return partial?.url ?? null;
}

function findNextLink(page: ExtractedPage): string | null {
  const byLabel = page.links.find((l) => NEXT_PATTERNS.some((p) => p.test(l.text)));
  if (byLabel) return byLabel.url;
  // Fall back to a rel=next-looking URL pattern.
  const byUrl = page.links.find((l) => /[?&](page|p|offset|start)=\d+/i.test(l.url));
  return byUrl?.url ?? null;
}

export async function runBrowserSession(
  actions: BrowserAction[],
  options: BrowseOptions = {}
): Promise<BrowseResult> {
  if (actions.length === 0) {
    throw new CloudaError("invalid_request", "En az bir eylem gerekiyor.");
  }
  if (actions[0].type !== "open" || !actions[0].url) {
    throw new CloudaError("invalid_request", "İlk eylem bir 'open' ve URL içermeli.");
  }

  const maxSteps = Math.min(options.maxSteps ?? DEFAULT_MAX_STEPS, HARD_MAX_STEPS);
  const maxDuration = Math.min(options.maxDurationMs ?? DEFAULT_MAX_DURATION, 90_000);
  const started = Date.now();

  const trace: StepTrace[] = [];
  const pagesVisited: string[] = [];
  let page: ExtractedPage | null = null;
  let matches: { text: string; context: string }[] = [];
  let steps = 0;
  let stoppedReason: BrowseResult["stoppedReason"] = "completed";

  const queue: BrowserAction[] = [...actions];

  while (queue.length > 0) {
    if (steps >= maxSteps) {
      stoppedReason = "step_limit";
      break;
    }
    if (Date.now() - started > maxDuration) {
      stoppedReason = "time_limit";
      break;
    }

    const action = queue.shift() as BrowserAction;
    const stepStarted = Date.now();
    steps++;

    try {
      switch (action.type) {
        case "open": {
          if (!action.url) throw new CloudaError("invalid_request", "'open' bir URL gerektirir.");
          page = await loadPage(action.url, options.policy);
          pagesVisited.push(page.url);
          trace.push({
            step: steps,
            action: "open",
            url: page.url,
            status: "ok",
            detail: page.title,
            tookMs: Date.now() - stepStarted,
          });
          break;
        }

        case "follow": {
          if (!page) throw new CloudaError("invalid_request", "Önce bir sayfa açılmalı.");
          if (!action.linkText) {
            throw new CloudaError("invalid_request", "'follow' bir linkText gerektirir.");
          }
          const target = resolveLink(page, action.linkText);
          if (!target) {
            throw new CloudaError("not_found", `Sayfada bu bağlantı bulunamadı: ${action.linkText}`);
          }
          page = await loadPage(target, options.policy);
          pagesVisited.push(page.url);
          trace.push({
            step: steps,
            action: "follow",
            url: page.url,
            status: "ok",
            detail: action.linkText,
            tookMs: Date.now() - stepStarted,
          });
          break;
        }

        case "paginate": {
          if (!page) throw new CloudaError("invalid_request", "Önce bir sayfa açılmalı.");
          const next = findNextLink(page);
          if (!next) {
            trace.push({
              step: steps,
              action: "paginate",
              url: page.url,
              status: "failed",
              detail: "sonraki sayfa bağlantısı yok",
              tookMs: Date.now() - stepStarted,
            });
            break;
          }
          page = await loadPage(next, options.policy);
          pagesVisited.push(page.url);
          trace.push({
            step: steps,
            action: "paginate",
            url: page.url,
            status: "ok",
            detail: `sayfa ${pagesVisited.length}`,
            tookMs: Date.now() - stepStarted,
          });
          // Queue further pages when the caller asked for several.
          const remaining = (action.pages ?? 1) - 1;
          if (remaining > 0) queue.unshift({ type: "paginate", pages: remaining });
          break;
        }

        case "find": {
          if (!page) throw new CloudaError("invalid_request", "Önce bir sayfa açılmalı.");
          if (!action.query) throw new CloudaError("invalid_request", "'find' bir query gerektirir.");
          matches = findInPage(page, action.query);
          trace.push({
            step: steps,
            action: "find",
            url: page.url,
            status: matches.length > 0 ? "ok" : "failed",
            detail: `${matches.length} eşleşme`,
            tookMs: Date.now() - stepStarted,
          });
          break;
        }

        case "submit": {
          // GET-only: filling a search box is navigation, posting is not.
          if (!action.url && !page) {
            throw new CloudaError("invalid_request", "'submit' bir URL ya da açık sayfa gerektirir.");
          }
          const base = action.url ?? page!.url;
          const url = new URL(base);
          for (const [key, value] of Object.entries(action.fields ?? {})) {
            url.searchParams.set(key, value);
          }
          page = await loadPage(url.toString(), options.policy);
          pagesVisited.push(page.url);
          trace.push({
            step: steps,
            action: "submit",
            url: page.url,
            status: "ok",
            detail: Object.keys(action.fields ?? {}).join(", ") || "-",
            tookMs: Date.now() - stepStarted,
          });
          break;
        }

        case "extract": {
          if (!page) throw new CloudaError("invalid_request", "Önce bir sayfa açılmalı.");
          trace.push({
            step: steps,
            action: "extract",
            url: page.url,
            status: "ok",
            detail: `${page.content.length} karakter`,
            tookMs: Date.now() - stepStarted,
          });
          break;
        }

        default:
          throw new CloudaError("invalid_request", `Bilinmeyen eylem: ${action.type}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.push({
        step: steps,
        action: action.type,
        url: action.url ?? page?.url ?? "-",
        status: "failed",
        detail: message.slice(0, 200),
        tookMs: Date.now() - stepStarted,
      });
      // A failed step ends the session only when nothing has loaded yet.
      if (!page) throw err;
    }
  }

  if (!page) throw new CloudaError("fetch_failed", "Hiçbir sayfa yüklenemedi.");
  if (queue.length > 0 && stoppedReason === "completed") stoppedReason = "step_limit";

  return {
    finalUrl: page.url,
    title: page.title,
    content: page.content,
    publishedAt: page.publishedAt,
    matches,
    links: page.links.slice(0, 25),
    pagesVisited,
    trace,
    steps,
    javascriptRequired: looksJavaScriptOnly(page),
    stoppedReason,
  };
}
