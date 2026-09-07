import { NextRequest } from "next/server";
import { withApi, readJson } from "@/lib/api/gateway";
import { parseInt_ } from "@/lib/api/shapes";
import { CloudaError } from "@/lib/core/errors";
import {
  DATA_KINDS,
  DataKind,
  DataRequest,
  fetchLiveData,
  INDICATOR_NAMES,
} from "@/lib/data/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Body {
  kind?: string;
  place?: string;
  days?: number;
  base?: string;
  symbols?: unknown;
  ids?: unknown;
  currencies?: unknown;
  symbol?: string;
  min_magnitude?: number;
  hours?: number;
  name?: string;
  country?: string;
  indicator?: string;
  years?: number;
}

function list(value: unknown, field: string, max: number): string[] | undefined {
  if (value == null) return undefined;
  const raw = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(raw)) {
    throw new CloudaError("invalid_request", `'${field}' dizi ya da virgülle ayrılmış metin olmalı.`);
  }
  const cleaned = raw
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, max);
  if (cleaned.some((v) => !/^[a-z0-9._-]+$/.test(v))) {
    throw new CloudaError("invalid_request", `'${field}' geçersiz bir değer içeriyor.`);
  }
  return cleaned;
}

function required(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new CloudaError("invalid_request", `'${field}' zorunlu.`);
  if (trimmed.length > 120) throw new CloudaError("invalid_request", `'${field}' çok uzun.`);
  return trimmed;
}

/**
 * POST /api/v1/data — live facts as values, not as pages about values.
 *
 * Search is the wrong instrument for "what is the dollar rate" or "how warm is
 * it in Izmir". A model that asks those through a search engine gets an
 * article quoting a number from whenever it was written, presented with the
 * same confidence as a current one — which is precisely how a stale figure
 * ends up stated as fact. Here the answer is the number, with the timestamp it
 * was measured at, every time.
 *
 * All seven sources are keyless and were measured from this deployment before
 * being wired in. Priced at one credit: these are single small JSON calls,
 * usually served from a shared cache, and nothing is extracted or ranked.
 */
export const POST = withApi(
  { operation: "search" },
  async (req: NextRequest) => {
    const body = await readJson<Body>(req);

    const kind = String(body.kind ?? "").trim() as DataKind;
    if (!DATA_KINDS.includes(kind)) {
      throw new CloudaError(
        "invalid_request",
        `'kind' şunlardan biri olmalı: ${DATA_KINDS.join(", ")}`,
        { supported: DATA_KINDS }
      );
    }

    const request: DataRequest = { kind };

    switch (kind) {
      case "weather":
        request.place = required(body.place ?? body.name, "place");
        request.days = parseInt_(body.days, 1, 7, 3);
        break;
      case "fx":
        request.base = (body.base ?? "EUR").trim().toUpperCase().slice(0, 3);
        request.symbols = (list(body.symbols, "symbols", 12) ?? []).map((s) => s.toUpperCase());
        break;
      case "crypto":
        request.ids = list(body.ids, "ids", 10) ?? ["bitcoin"];
        request.currencies = list(body.currencies, "currencies", 6) ?? ["usd"];
        break;
      case "stock":
        request.symbol = required(body.symbol, "symbol").toUpperCase();
        break;
      case "earthquakes": {
        const magnitude = body.min_magnitude == null ? 4.5 : Number(body.min_magnitude);
        if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 10) {
          throw new CloudaError("invalid_request", "'min_magnitude' 0 ile 10 arasında olmalı.");
        }
        request.minMagnitude = magnitude;
        request.hours = parseInt_(body.hours, 1, 168, 24);
        break;
      }
      case "country":
        request.name = required(body.name ?? body.country, "name");
        break;
      case "indicator":
        request.countryCode = required(body.country, "country");
        request.indicator = (body.indicator ?? "gdp").trim().toLowerCase();
        if (!INDICATOR_NAMES.includes(request.indicator)) {
          throw new CloudaError(
            "invalid_request",
            `Bilinmeyen gösterge: ${request.indicator}. Desteklenenler: ${INDICATOR_NAMES.join(", ")}`,
            { supported: INDICATOR_NAMES }
          );
        }
        request.years = parseInt_(body.years, 1, 60, 10);
        break;
    }

    const result = await fetchLiveData(request);
    const cached = result.ageSeconds != null;

    return {
      body: {
        kind: result.kind,
        source: result.source,
        // Two different timestamps on purpose. A caller that treats "we
        // fetched this now" as "this was measured now" will report a Friday
        // exchange rate as Sunday's, and that is the mistake this endpoint
        // exists to prevent.
        observed_at: result.observedAt,
        retrieved_at: result.retrievedAt,
        cached,
        ...(cached ? { cache_age_seconds: result.ageSeconds } : {}),
        ...result.data,
      },
      resultCount: 1,
      provider: result.source,
      cacheHit: cached,
      label: `${kind}:${request.place ?? request.symbol ?? request.name ?? request.base ?? request.indicator ?? ""}`,
    };
  }
);

/** Self-describing, so an agent can discover the shapes without the docs. */
export async function GET() {
  return Response.json({
    endpoint: "POST /api/v1/data",
    kinds: {
      weather: { place: "İzmir", days: "1-7 (varsayılan 3)" },
      fx: { base: "EUR", symbols: ["USD", "TRY"] },
      crypto: { ids: ["bitcoin", "ethereum"], currencies: ["usd", "try"] },
      stock: { symbol: "AAPL" },
      earthquakes: { min_magnitude: 4.5, hours: "1-168 (varsayılan 24)" },
      country: { name: "Türkiye" },
      indicator: { country: "TR", indicator: INDICATOR_NAMES, years: "1-60" },
    },
  });
}
