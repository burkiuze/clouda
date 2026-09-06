import { safeFetch } from "@/lib/core/http";
import { CloudaError } from "@/lib/core/errors";
import { cacheGet, cacheSet } from "@/lib/core/cache";

/**
 * Live facts, as numbers rather than as pages about numbers.
 *
 * Search is the wrong tool for "what is the dollar rate" or "how warm is it in
 * Izmir". A model asking that through a search engine gets an article that
 * quotes a rate from whenever the article was written, presented with the same
 * confidence as a current one — which is exactly how a model ends up stating a
 * stale number as fact. These sources answer with the value and the timestamp
 * it was measured at, and the timestamp is returned every time so the caller
 * can see for itself how old the number is.
 *
 * Every source below was measured from this deployment's egress first. All of
 * them are keyless. Where an obvious candidate is missing it is because it
 * did not answer: gutendex refuses us outright, and Semantic Scholar rate
 * limits anonymous datacenter traffic.
 */

const TIMEOUT_MS = 4000;

/**
 * Cache windows, set by how fast each number actually moves. A central bank
 * publishes reference rates once a day, so caching them for ten minutes costs
 * nothing and saves a round trip; a share price does move, so it gets one
 * minute; an earthquake feed is the reason someone is asking, so thirty
 * seconds.
 */
const TTL = {
  weather: 600,
  fx: 600,
  crypto: 60,
  stock: 60,
  earthquakes: 30,
  country: 86_400,
  indicator: 86_400,
} as const;

export type DataKind = keyof typeof TTL;
export const DATA_KINDS = Object.keys(TTL) as DataKind[];

async function json<T>(url: string): Promise<T> {
  const res = await safeFetch(url, { trusted: true, timeoutMs: TIMEOUT_MS });
  if (res.status >= 400) {
    throw new CloudaError("provider_failed", `Veri kaynağı ${res.status} döndü.`, {
      status: res.status,
    });
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new CloudaError("provider_failed", "Veri kaynağı geçerli JSON döndürmedi.");
  }
}

export interface DataResult {
  kind: DataKind;
  source: string;
  /** When the underlying source says the value was measured. */
  observedAt: string | null;
  /** When we fetched it, which is not the same thing. */
  retrievedAt: string;
  data: Record<string, unknown>;
  /** Present when the answer came from cache, in seconds. */
  ageSeconds?: number;
}

/* ------------------------------------------------------------- weather */

interface GeoHit {
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

/** Resolves a place name to coordinates. Also useful on its own. */
export async function geocode(place: string): Promise<GeoHit> {
  const data = await json<{ results?: GeoHit[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=tr&format=json`
  );
  const hit = data.results?.[0];
  if (!hit) {
    throw new CloudaError("not_found", `Yer bulunamadı: ${place}`, { place });
  }
  return hit;
}

const WEATHER_CODES: Record<number, string> = {
  0: "açık", 1: "az bulutlu", 2: "parçalı bulutlu", 3: "çok bulutlu",
  45: "sisli", 48: "kırağılı sis", 51: "hafif çisenti", 53: "çisenti",
  55: "yoğun çisenti", 61: "hafif yağmur", 63: "yağmur", 65: "kuvvetli yağmur",
  71: "hafif kar", 73: "kar", 75: "yoğun kar", 77: "kar taneleri",
  80: "sağanak", 81: "kuvvetli sağanak", 82: "şiddetli sağanak",
  95: "gök gürültülü fırtına", 96: "dolulu fırtına", 99: "şiddetli dolulu fırtına",
};

async function weather(place: string, days: number): Promise<DataResult> {
  const spot = await geocode(place);

  const data = await json<{
    current?: Record<string, number | string>;
    current_units?: Record<string, string>;
    daily?: Record<string, (number | string)[]>;
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum" +
      `&forecast_days=${days}&timezone=auto`
  );

  const code = Number(data.current?.weather_code ?? -1);
  const daily = data.daily ?? {};

  return {
    kind: "weather",
    source: "open-meteo",
    observedAt: typeof data.current?.time === "string" ? data.current.time : null,
    retrievedAt: new Date().toISOString(),
    data: {
      place: `${spot.name}${spot.admin1 ? `, ${spot.admin1}` : ""}, ${spot.country}`,
      coordinates: { latitude: spot.latitude, longitude: spot.longitude },
      timezone: spot.timezone ?? null,
      current: {
        temperature_c: data.current?.temperature_2m ?? null,
        feels_like_c: data.current?.apparent_temperature ?? null,
        humidity_pct: data.current?.relative_humidity_2m ?? null,
        precipitation_mm: data.current?.precipitation ?? null,
        wind_kmh: data.current?.wind_speed_10m ?? null,
        condition: WEATHER_CODES[code] ?? null,
        weather_code: code >= 0 ? code : null,
      },
      forecast: (daily.time ?? []).map((date, i) => ({
        date,
        condition: WEATHER_CODES[Number(daily.weather_code?.[i] ?? -1)] ?? null,
        max_c: daily.temperature_2m_max?.[i] ?? null,
        min_c: daily.temperature_2m_min?.[i] ?? null,
        precipitation_mm: daily.precipitation_sum?.[i] ?? null,
      })),
    },
  };
}

/* ------------------------------------------------------------------ fx */

async function fx(base: string, symbols: string[]): Promise<DataResult> {
  const to = symbols.length > 0 ? `&to=${symbols.join(",")}` : "";
  const data = await json<{ base?: string; date?: string; rates?: Record<string, number> }>(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}${to}`
  );

  if (!data.rates || Object.keys(data.rates).length === 0) {
    throw new CloudaError("not_found", `Kur bulunamadı: ${base} → ${symbols.join(",") || "hepsi"}`);
  }

  return {
    kind: "fx",
    source: "frankfurter (ECB referans kurları)",
    // The date the rates are for, which on a weekend is not today. Returned as
    // it is rather than smoothed over: a caller comparing a Saturday quote to
    // Friday's close needs to know it is Friday's number.
    observedAt: data.date ?? null,
    retrievedAt: new Date().toISOString(),
    data: { base: data.base ?? base.toUpperCase(), rates: data.rates },
  };
}

/* -------------------------------------------------------------- crypto */

async function crypto(ids: string[], currencies: string[]): Promise<DataResult> {
  const data = await json<Record<string, Record<string, number>>>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}` +
      `&vs_currencies=${currencies.join(",")}&include_24hr_change=true&include_last_updated_at=true`
  );

  if (Object.keys(data).length === 0) {
    throw new CloudaError("not_found", `Kripto varlık bulunamadı: ${ids.join(", ")}`);
  }

  const stamps = Object.values(data)
    .map((v) => v.last_updated_at)
    .filter((v): v is number => typeof v === "number");

  return {
    kind: "crypto",
    source: "coingecko",
    observedAt: stamps.length > 0 ? new Date(Math.max(...stamps) * 1000).toISOString() : null,
    retrievedAt: new Date().toISOString(),
    data: { prices: data },
  };
}

/* --------------------------------------------------------------- stock */

async function stock(symbol: string): Promise<DataResult> {
  const data = await json<{
    chart?: {
      result?: {
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
      error?: { description?: string } | null;
    };
  }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
  );

  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) {
    throw new CloudaError("not_found", `Sembol bulunamadı: ${symbol}`, {
      detail: data.chart?.error?.description ?? null,
    });
  }

  const price = Number(meta.regularMarketPrice ?? NaN);
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose ?? NaN);
  const stamp = Number(meta.regularMarketTime ?? NaN);

  const closes = (result.indicators?.quote?.[0]?.close ?? [])
    .map((c, i) => ({ date: result.timestamp?.[i], close: c }))
    .filter((p) => p.close != null && p.date != null)
    .map((p) => ({ date: new Date((p.date as number) * 1000).toISOString().slice(0, 10), close: p.close }));

  return {
    kind: "stock",
    source: "yahoo finance",
    observedAt: Number.isFinite(stamp) ? new Date(stamp * 1000).toISOString() : null,
    retrievedAt: new Date().toISOString(),
    data: {
      symbol: meta.symbol ?? symbol.toUpperCase(),
      name: meta.longName ?? meta.shortName ?? null,
      exchange: meta.fullExchangeName ?? null,
      currency: meta.currency ?? null,
      price: Number.isFinite(price) ? price : null,
      previous_close: Number.isFinite(previous) ? previous : null,
      change:
        Number.isFinite(price) && Number.isFinite(previous)
          ? Number((price - previous).toFixed(4))
          : null,
      change_pct:
        Number.isFinite(price) && Number.isFinite(previous) && previous !== 0
          ? Number((((price - previous) / previous) * 100).toFixed(3))
          : null,
      market_state: meta.marketState ?? null,
      recent_closes: closes,
    },
  };
}

/* --------------------------------------------------------- earthquakes */

async function earthquakes(minMagnitude: number, hours: number): Promise<DataResult> {
  // The feeds are pre-built by magnitude and window; the closest one is fetched
  // and then filtered exactly, which is cheaper than a parameterised query.
  const feed = minMagnitude >= 4.5 ? "4.5" : minMagnitude >= 2.5 ? "2.5" : "all";
  const window = hours <= 1 ? "hour" : hours <= 24 ? "day" : "week";

  const data = await json<{
    features?: {
      properties?: { mag?: number; place?: string; time?: number; url?: string; tsunami?: number };
      geometry?: { coordinates?: number[] };
    }[];
  }>(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}_${window}.geojson`);

  const cutoff = Date.now() - hours * 3_600_000;
  const quakes = (data.features ?? [])
    .filter((f) => (f.properties?.mag ?? 0) >= minMagnitude && (f.properties?.time ?? 0) >= cutoff)
    .sort((a, b) => (b.properties?.time ?? 0) - (a.properties?.time ?? 0))
    .slice(0, 50)
    .map((f) => ({
      magnitude: f.properties?.mag ?? null,
      place: f.properties?.place ?? null,
      time: f.properties?.time ? new Date(f.properties.time).toISOString() : null,
      depth_km: f.geometry?.coordinates?.[2] ?? null,
      latitude: f.geometry?.coordinates?.[1] ?? null,
      longitude: f.geometry?.coordinates?.[0] ?? null,
      tsunami: Boolean(f.properties?.tsunami),
      url: f.properties?.url ?? null,
    }));

  return {
    kind: "earthquakes",
    source: "usgs",
    observedAt: quakes[0]?.time ?? null,
    retrievedAt: new Date().toISOString(),
    data: { window_hours: hours, min_magnitude: minMagnitude, count: quakes.length, events: quakes },
  };
}

/* ------------------------------------------------------------- country */

async function country(name: string): Promise<DataResult> {
  const data = await json<
    {
      name?: { common?: string; official?: string };
      cca2?: string;
      capital?: string[];
      region?: string;
      subregion?: string;
      population?: number;
      area?: number;
      languages?: Record<string, string>;
      currencies?: Record<string, { name?: string; symbol?: string }>;
      timezones?: string[];
      latlng?: number[];
    }[]
  >(
    `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,cca2,capital,region,subregion,population,area,languages,currencies,timezones,latlng`
  );

  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) throw new CloudaError("not_found", `Ülke bulunamadı: ${name}`, { name });

  return {
    kind: "country",
    source: "restcountries",
    observedAt: null,
    retrievedAt: new Date().toISOString(),
    data: {
      name: hit.name?.common ?? name,
      official_name: hit.name?.official ?? null,
      code: hit.cca2 ?? null,
      capital: hit.capital?.[0] ?? null,
      region: [hit.region, hit.subregion].filter(Boolean).join(" / ") || null,
      population: hit.population ?? null,
      area_km2: hit.area ?? null,
      languages: Object.values(hit.languages ?? {}),
      currencies: Object.entries(hit.currencies ?? {}).map(([code, c]) => ({
        code,
        name: c.name ?? null,
        symbol: c.symbol ?? null,
      })),
      timezones: hit.timezones ?? [],
      coordinates: hit.latlng ? { latitude: hit.latlng[0], longitude: hit.latlng[1] } : null,
    },
  };
}

/* ----------------------------------------------------------- indicator */

/** The handful of World Bank series a caller is most likely to want by name. */
const INDICATORS: Record<string, { code: string; label: string }> = {
  gdp: { code: "NY.GDP.MKTP.CD", label: "GSYİH (cari ABD doları)" },
  gdp_per_capita: { code: "NY.GDP.PCAP.CD", label: "Kişi başına GSYİH (cari ABD doları)" },
  population: { code: "SP.POP.TOTL", label: "Nüfus" },
  inflation: { code: "FP.CPI.TOTL.ZG", label: "Enflasyon, TÜFE (yıllık %)" },
  unemployment: { code: "SL.UEM.TOTL.ZS", label: "İşsizlik (işgücünün %'si)" },
  life_expectancy: { code: "SP.DYN.LE00.IN", label: "Doğumda beklenen yaşam süresi" },
  internet_users: { code: "IT.NET.USER.ZS", label: "İnternet kullanan nüfus (%)" },
  co2: { code: "EN.GHG.CO2.PC.CE.AR5", label: "Kişi başına CO2 (ton)" },
};

export const INDICATOR_NAMES = Object.keys(INDICATORS);

async function indicator(countryCode: string, name: string, years: number): Promise<DataResult> {
  const series = INDICATORS[name];
  if (!series) {
    throw new CloudaError(
      "invalid_request",
      `Bilinmeyen gösterge: ${name}. Desteklenenler: ${INDICATOR_NAMES.join(", ")}`
    );
  }

  const payload = await json<unknown[]>(
    `https://api.worldbank.org/v2/country/${encodeURIComponent(countryCode)}/indicator/${series.code}` +
      `?format=json&per_page=${years}`
  );

  const rows = Array.isArray(payload) && Array.isArray(payload[1])
    ? (payload[1] as { date?: string; value?: number | null; country?: { value?: string } }[])
    : [];

  if (rows.length === 0) {
    throw new CloudaError("not_found", `Veri bulunamadı: ${countryCode} / ${name}`);
  }

  const points = rows
    .filter((r) => r.value != null)
    .map((r) => ({ year: r.date, value: r.value }));

  return {
    kind: "indicator",
    source: "world bank",
    observedAt: points[0]?.year ? `${points[0].year}-12-31` : null,
    retrievedAt: new Date().toISOString(),
    data: {
      country: rows[0]?.country?.value ?? countryCode.toUpperCase(),
      indicator: name,
      indicator_code: series.code,
      label: series.label,
      latest: points[0] ?? null,
      series: points,
    },
  };
}

/* ---------------------------------------------------------------- entry */

export interface DataRequest {
  kind: DataKind;
  place?: string;
  days?: number;
  base?: string;
  symbols?: string[];
  ids?: string[];
  currencies?: string[];
  symbol?: string;
  minMagnitude?: number;
  hours?: number;
  name?: string;
  countryCode?: string;
  indicator?: string;
  years?: number;
}

function cacheKeyFor(request: DataRequest): string {
  // Every field that changes the answer, in a stable order.
  return [
    request.kind,
    request.place,
    request.days,
    request.base,
    request.symbols?.join("+"),
    request.ids?.join("+"),
    request.currencies?.join("+"),
    request.symbol,
    request.minMagnitude,
    request.hours,
    request.name,
    request.countryCode,
    request.indicator,
    request.years,
  ]
    .map((part) => (part == null ? "" : String(part).toLowerCase()))
    .join("|");
}

async function dispatch(request: DataRequest): Promise<DataResult> {
  switch (request.kind) {
    case "weather":
      return weather(request.place ?? "", request.days ?? 3);
    case "fx":
      return fx(request.base ?? "EUR", request.symbols ?? []);
    case "crypto":
      return crypto(request.ids ?? ["bitcoin"], request.currencies ?? ["usd"]);
    case "stock":
      return stock(request.symbol ?? "");
    case "earthquakes":
      return earthquakes(request.minMagnitude ?? 4.5, request.hours ?? 24);
    case "country":
      return country(request.name ?? "");
    case "indicator":
      return indicator(request.countryCode ?? "", request.indicator ?? "gdp", request.years ?? 10);
  }
}

/**
 * Answers one request, from cache when the number has not had time to move.
 *
 * The cache is shared rather than per-instance: these are public facts, not
 * per-caller results, so one account's request for the dollar rate should
 * answer the next account's for free.
 */
export async function fetchLiveData(request: DataRequest): Promise<DataResult> {
  const lookup = { namespace: "livedata", query: cacheKeyFor(request), locale: "-" };

  const hit = await cacheGet<DataResult>(lookup);
  if (hit) return { ...hit.payload, ageSeconds: hit.ageSeconds };

  const result = await dispatch(request);
  await cacheSet(lookup, result, TTL[request.kind]);
  return result;
}
