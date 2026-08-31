/**
 * One error vocabulary for the whole API. Every failure an agent can hit has a
 * stable machine code and an HTTP status, so callers branch on `error` rather
 * than parsing prose.
 */

export type ErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "revoked_api_key"
  | "capability_not_enabled"
  | "insufficient_credits"
  | "credit_cap_reached"
  | "rate_limited"
  | "invalid_request"
  | "query_too_long"
  | "invalid_url"
  | "blocked_url"
  | "domain_not_allowed"
  | "robots_disallowed"
  | "fetch_failed"
  | "fetch_timeout"
  | "page_too_large"
  | "unsupported_content_type"
  | "captcha_encountered"
  | "provider_failed"
  | "no_provider_available"
  | "no_results"
  | "step_limit_reached"
  | "budget_exhausted"
  | "not_found"
  | "database_unavailable"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  missing_api_key: 401,
  invalid_api_key: 401,
  revoked_api_key: 401,
  capability_not_enabled: 403,
  insufficient_credits: 402,
  credit_cap_reached: 402,
  rate_limited: 429,
  invalid_request: 400,
  query_too_long: 400,
  invalid_url: 400,
  blocked_url: 403,
  domain_not_allowed: 403,
  robots_disallowed: 403,
  fetch_failed: 502,
  fetch_timeout: 504,
  page_too_large: 413,
  unsupported_content_type: 415,
  captcha_encountered: 502,
  provider_failed: 502,
  no_provider_available: 503,
  no_results: 200,
  step_limit_reached: 400,
  budget_exhausted: 400,
  not_found: 404,
  database_unavailable: 503,
  internal_error: 500,
};

/** Failures worth retrying with the same input after a short wait. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "rate_limited",
  "fetch_failed",
  "fetch_timeout",
  "provider_failed",
  "no_provider_available",
  "database_unavailable",
]);

export class CloudaError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CloudaError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isCloudaError(err: unknown): err is CloudaError {
  return err instanceof CloudaError;
}

/** Wraps anything thrown deeper in the stack into the shared vocabulary. */
export function toCloudaError(err: unknown): CloudaError {
  if (isCloudaError(err)) return err;

  const message = err instanceof Error ? err.message : String(err);
  // Prisma cannot reach the database, which is a deployment state rather than
  // a caller mistake.
  if (/database|ECONNREFUSED|P1001|DATABASE_URL/i.test(message)) {
    return new CloudaError(
      "database_unavailable",
      "Veritabanına ulaşılamıyor. DATABASE_URL yapılandırmasını kontrol edin."
    );
  }
  return new CloudaError("internal_error", message);
}
