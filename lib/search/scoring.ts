import { QualityScores, RawResult } from "@/lib/search/types";
import { tokenize, normalize } from "@/lib/search/query";

/**
 * Quality scoring.
 *
 * Every result carries four numbers in 0-1 so an agent can decide what to
 * trust rather than assuming rank order is truth. The formulas below are the
 * contract — they are documented on the docs page in the same terms.
 *
 *   relevance   term coverage across title, snippet and content, with the
 *               title weighted highest and exact-phrase presence bonused
 *   credibility domain class (primary source, reference, academic, news,
 *               community, unknown) adjusted by page-level signals
 *   freshness   exponential decay on the age of the content; when no date is
 *               known it returns a neutral 0.5 rather than guessing
 *   overall     weighted blend, re-weighted by intent: a news query leans on
 *               freshness, an academic one on credibility
 */

/** Domains whose statements are the primary record of their own subject. */
const PRIMARY_SOURCE_HOSTS = [
  /(^|\.)gov(\.[a-z]{2})?$/,
  /(^|\.)gov\.tr$/,
  /(^|\.)edu(\.[a-z]{2})?$/,
  /(^|\.)europa\.eu$/,
  /(^|\.)who\.int$/,
  /(^|\.)un\.org$/,
  /(^|\.)tcmb\.gov\.tr$/,
  /(^|\.)tuik\.gov\.tr$/,
];

const ACADEMIC_HOSTS = [
  /(^|\.)doi\.org$/,
  /(^|\.)arxiv\.org$/,
  /(^|\.)nature\.com$/,
  /(^|\.)science\.org$/,
  /(^|\.)springer\.com$/,
  /(^|\.)sciencedirect\.com$/,
  /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/,
  /(^|\.)ieee\.org$/,
  /(^|\.)acm\.org$/,
];

const REFERENCE_HOSTS = [/(^|\.)wikipedia\.org$/, /(^|\.)britannica\.com$/];

const MAJOR_NEWS_HOSTS = [
  /(^|\.)reuters\.com$/,
  /(^|\.)apnews\.com$/,
  /(^|\.)bbc\.(com|co\.uk)$/,
  /(^|\.)ft\.com$/,
  /(^|\.)bloomberg\.com$/,
  /(^|\.)economist\.com$/,
  /(^|\.)nytimes\.com$/,
  /(^|\.)theguardian\.com$/,
  /(^|\.)aa\.com\.tr$/,
  /(^|\.)trthaber\.com$/,
];

const DOCS_HOSTS = [
  /(^|\.)developer\.mozilla\.org$/,
  /(^|\.)docs\.[a-z0-9-]+\.[a-z]+$/,
  /(^|\.)nextjs\.org$/,
  /(^|\.)python\.org$/,
  /(^|\.)postgresql\.org$/,
];

const COMMUNITY_HOSTS = [
  /(^|\.)stackoverflow\.com$/,
  /(^|\.)stackexchange\.com$/,
  /(^|\.)github\.com$/,
  /(^|\.)news\.ycombinator\.com$/,
  /(^|\.)reddit\.com$/,
  /(^|\.)medium\.com$/,
  /(^|\.)substack\.com$/,
];

/** Hosts whose content is aggregated or user-generated with little review. */
const LOW_TRUST_MARKERS = [
  /(^|\.)blogspot\./,
  /(^|\.)wordpress\.com$/,
  /(^|\.)wixsite\.com$/,
  /(^|\.)pinterest\./,
  /(^|\.)quora\.com$/,
];

interface CredibilityAssessment {
  score: number;
  signals: string[];
  isPrimary: boolean;
}

function assessCredibility(url: string, contentLength: number): CredibilityAssessment {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { score: 0.2, signals: ["geçersiz-url"], isPrimary: false };
  }

  const signals: string[] = [];
  let score = 0.45; // unknown but reachable
  let isPrimary = false;

  if (PRIMARY_SOURCE_HOSTS.some((r) => r.test(host))) {
    score = 0.95;
    isPrimary = true;
    signals.push("birincil-kaynak");
  } else if (ACADEMIC_HOSTS.some((r) => r.test(host))) {
    score = 0.9;
    isPrimary = true;
    signals.push("akademik");
  } else if (REFERENCE_HOSTS.some((r) => r.test(host))) {
    score = 0.78;
    signals.push("referans");
  } else if (MAJOR_NEWS_HOSTS.some((r) => r.test(host))) {
    score = 0.8;
    signals.push("kurumsal-haber");
  } else if (DOCS_HOSTS.some((r) => r.test(host))) {
    score = 0.85;
    isPrimary = true;
    signals.push("resmi-dokümantasyon");
  } else if (COMMUNITY_HOSTS.some((r) => r.test(host))) {
    score = 0.6;
    signals.push("topluluk");
  }

  if (LOW_TRUST_MARKERS.some((r) => r.test(host))) {
    score = Math.min(score, 0.35);
    signals.push("düşük-editoryal-denetim");
  }

  // HTTPS is table stakes; its absence is a real signal in 2026.
  if (url.startsWith("http://")) {
    score -= 0.08;
    signals.push("şifresiz-bağlantı");
  }

  // A page we could actually read is worth more than a bare link.
  if (contentLength > 1200) {
    score += 0.05;
    signals.push("dolu-içerik");
  } else if (contentLength < 200) {
    score -= 0.08;
    signals.push("içerik-çıkarılamadı");
  }

  return { score: Math.max(0, Math.min(1, score)), signals, isPrimary };
}

function computeRelevance(query: string, result: RawResult, content: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0.5;

  const title = normalize(result.title);
  const snippet = normalize(result.snippet);
  const body = normalize(content.slice(0, 4000));

  let titleHits = 0;
  let snippetHits = 0;
  let bodyHits = 0;

  for (const term of terms) {
    if (title.includes(term)) titleHits++;
    if (snippet.includes(term)) snippetHits++;
    if (body.includes(term)) bodyHits++;
  }

  const coverage =
    (titleHits / terms.length) * 0.5 +
    (snippetHits / terms.length) * 0.3 +
    (bodyHits / terms.length) * 0.2;

  // An exact phrase match is much stronger evidence than scattered terms.
  const phrase = normalize(query);
  const phraseBonus = phrase.length > 8 && (title.includes(phrase) || body.includes(phrase)) ? 0.15 : 0;

  return Math.max(0, Math.min(1, coverage + phraseBonus));
}

/** Exponential decay with a half-life chosen per intent. */
function computeFreshness(publishedAt: string | null | undefined, halfLifeHours: number): number {
  if (!publishedAt) return 0.5; // unknown, not old
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0.5;

  const ageHours = Math.max(0, (Date.now() - ts) / 3_600_000);
  return Number(Math.pow(0.5, ageHours / halfLifeHours).toFixed(3));
}

const HALF_LIFE_BY_INTENT: Record<string, number> = {
  news: 24,
  finance: 12,
  product: 24 * 30,
  technical: 24 * 180,
  academic: 24 * 365,
  general: 24 * 90,
};

const WEIGHTS_BY_INTENT: Record<string, { r: number; c: number; f: number }> = {
  news: { r: 0.35, c: 0.25, f: 0.4 },
  finance: { r: 0.3, c: 0.3, f: 0.4 },
  product: { r: 0.45, c: 0.3, f: 0.25 },
  academic: { r: 0.35, c: 0.55, f: 0.1 },
  technical: { r: 0.45, c: 0.4, f: 0.15 },
  general: { r: 0.45, c: 0.4, f: 0.15 },
};

export interface ScoreInput {
  query: string;
  intent: string;
  result: RawResult;
  content: string;
  /** How many other results share this result's host or claim, if known. */
  corroboration?: number;
}

export function scoreResult(input: ScoreInput): QualityScores {
  const { query, intent, result, content } = input;

  const relevance = computeRelevance(query, result, content);
  const cred = assessCredibility(result.url, content.length);
  const freshness = computeFreshness(result.publishedAt, HALF_LIFE_BY_INTENT[intent] ?? 24 * 90);

  let credibility = cred.score;
  const signals = [...cred.signals];

  // Corroboration by independent results is a genuine credibility signal.
  if (input.corroboration && input.corroboration > 1) {
    credibility = Math.min(1, credibility + Math.min(0.1, 0.03 * input.corroboration));
    signals.push(`${input.corroboration}-kaynakça-desteklenen`);
  }

  const w = WEIGHTS_BY_INTENT[intent] ?? WEIGHTS_BY_INTENT.general;
  const overall = relevance * w.r + credibility * w.c + freshness * w.f;

  return {
    relevance: Number(relevance.toFixed(3)),
    credibility: Number(credibility.toFixed(3)),
    freshness,
    overall: Number(overall.toFixed(3)),
    signals,
  };
}

export function isPrimarySource(url: string): boolean {
  return assessCredibility(url, 0).isPrimary;
}
