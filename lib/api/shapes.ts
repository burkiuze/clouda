import { CloudaError } from "@/lib/core/errors";
import { FRESHNESS_WINDOWS } from "@/lib/constants";
import type { SearchResult } from "@/lib/search/types";

/**
 * Response shaping. The same underlying results can be returned in several
 * modes so an agent asks for exactly the payload it will parse — links only
 * when it just needs URLs, claims when it needs something citable.
 */

export type ResponseMode = "results" | "sources" | "claims" | "report";

export function parseMode(value: unknown, allowed: ResponseMode[]): ResponseMode {
  if (value == null) return allowed[0];
  if (typeof value !== "string" || !allowed.includes(value as ResponseMode)) {
    throw new CloudaError(
      "invalid_request",
      `Geçersiz mod: ${String(value)}. Desteklenenler: ${allowed.join(", ")}`
    );
  }
  return value as ResponseMode;
}

/**
 * Accepts either a named window ("day") or a number of hours, and returns
 * hours. Null means "no freshness constraint".
 */
export function parseFreshness(value: unknown): number | null | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const named = FRESHNESS_WINDOWS[value.toLowerCase()];
    if (named) return named;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  throw new CloudaError(
    "invalid_request",
    `Geçersiz freshness: ${String(value)}. hour, day, week, month, year ya da saat sayısı kullan.`
  );
}

export function parseLocale(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(value)) return value;
  throw new CloudaError("invalid_request", `Geçersiz locale: ${String(value)}. Örnek: tr-TR`);
}

export function parseInt_(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new CloudaError("invalid_request", `Sayı bekleniyordu: ${String(value)}`);
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Serialises a result for the wire, dropping content in the lighter modes. */
export function shapeResult(result: SearchResult, mode: ResponseMode) {
  const base = {
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    published_at: result.publishedAt,
    updated_at: result.updatedAt ?? null,
    source: result.source,
    scores: {
      relevance: result.scores.relevance,
      credibility: result.scores.credibility,
      freshness: result.scores.freshness,
      overall: result.scores.overall,
      signals: result.scores.signals,
    },
  };

  if (mode === "sources") return base;
  return { ...base, content: result.content };
}
