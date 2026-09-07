import { NextRequest, NextResponse } from "next/server";
import { CloudaError, toCloudaError } from "@/lib/core/errors";
import { recordUsage, Operation } from "@/lib/core/metrics";
import { offload } from "@/lib/core/offload";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * The wrapper every endpoint passes through: one consistent error envelope,
 * one place that records timings, and an optional shared token.
 *
 * It used to authenticate an API key, check a capability, enforce a per-key
 * rate limit and reserve credits against a balance. None of that describes a
 * tool you run for yourself. What replaced it is deliberately small, because
 * the honest amount of ceremony between you and your own machine is none.
 */

export interface ApiContext {
  /** Per-request domain restrictions, when the caller sets them. */
  policy: DomainPolicy;
}

export interface HandlerResult {
  body: Record<string, unknown>;
  resultCount?: number;
  provider?: string | null;
  cacheHit?: boolean;
  steps?: number;
  /** Free-text label for the log line, usually the query. */
  label: string;
}

/**
 * Optional shared secret.
 *
 * Unset — the normal case — means the server answers anyone who can reach it,
 * which on localhost is you. Set it when you bind to something other than
 * loopback, because at that point "anyone who can reach it" stops meaning you.
 */
const TOKEN = process.env.CLOUDA_TOKEN ?? "";

function authorize(req: NextRequest): void {
  if (!TOKEN) return;

  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (supplied !== TOKEN) {
    throw new CloudaError(
      "unauthorized",
      "CLOUDA_TOKEN tanımlı; 'Authorization: Bearer <token>' başlığı gerekiyor."
    );
  }
}

export interface RouteOptions {
  operation: Operation;
}

export function withApi(
  options: RouteOptions,
  handler: (req: NextRequest, ctx: ApiContext) => Promise<HandlerResult>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const started = Date.now();

    try {
      authorize(req);

      const result = await handler(req, { policy: {} });
      const latencyMs = Date.now() - started;

      offload(() =>
        recordUsage({
          operation: options.operation,
          query: result.label,
          resultCount: result.resultCount ?? 0,
          provider: result.provider,
          latencyMs,
          cacheHit: result.cacheHit,
          steps: result.steps,
          success: true,
        })
      );

      return NextResponse.json({ ...result.body, took_ms: latencyMs });
    } catch (err) {
      const error = toCloudaError(err);
      const latencyMs = Date.now() - started;

      offload(() =>
        recordUsage({
          operation: options.operation,
          query: "",
          resultCount: 0,
          latencyMs,
          success: false,
          errorCode: error.code,
        })
      );

      return NextResponse.json(error.toJSON(), { status: error.status });
    }
  };
}

/** Parses a JSON body, refusing anything that is not an object. */
export async function readJson<T>(req: NextRequest): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new CloudaError("invalid_request", "Gövde geçerli JSON değil.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CloudaError("invalid_request", "Gövde bir JSON nesnesi olmalı.");
  }
  return parsed as T;
}

/** Whether a shared token is configured, for the health report. */
export const tokenConfigured = () => Boolean(TOKEN);
