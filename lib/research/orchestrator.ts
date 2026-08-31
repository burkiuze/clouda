import { CloudaError } from "@/lib/core/errors";
import { searchWeb } from "@/lib/search/engine";
import { decompose, detectIntent, planQuery, tokenize } from "@/lib/search/query";
import { verifyClaims, type Claim } from "@/lib/research/citations";
import { RESEARCH_DEPTHS, type ResearchDepth } from "@/lib/constants";
import type { SearchResult } from "@/lib/search/types";
import type { DomainPolicy } from "@/lib/core/security";

/**
 * Deep research.
 *
 * One question becomes a plan: split it into angles, search each, read the
 * sources, then look at what is still thin and search again to fill the gap.
 * The output is a structured report where every finding points back at the
 * sources it came from, and disagreements between sources are stated rather
 * than averaged away.
 *
 * Bounded on three axes at once — rounds, sources and wall-clock — because an
 * agent calling this needs a predictable ceiling on latency and cost.
 */

export interface ResearchBudget {
  maxSources: number;
  maxSearches: number;
  maxDurationMs: number;
}

export interface ResearchOptions {
  depth?: ResearchDepth;
  maxSources?: number;
  maxDurationMs?: number;
  locale?: string;
  freshnessHours?: number | null;
  domainPolicy?: DomainPolicy;
}

export interface ResearchSection {
  subQuestion: string;
  summary: string;
  findings: Claim[];
  sourceUrls: string[];
}

export interface ResearchReport {
  question: string;
  depth: ResearchDepth;
  /** Sub-questions the research actually pursued. */
  plan: string[];
  summary: string;
  sections: ResearchSection[];
  /** Every claim across sections, strongest support first. */
  keyFindings: Claim[];
  /** Points where sources disagree, stated explicitly. */
  conflicts: Claim[];
  sources: {
    url: string;
    title: string;
    publishedAt: string | null;
    credibility: number;
    usedFor: string[];
  }[];
  stats: {
    searches: number;
    sourcesExamined: number;
    rounds: number;
    durationMs: number;
    budgetExhausted: boolean;
  };
  /** Aspects the research could not substantiate. */
  gaps: string[];
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Builds a short summary out of the best-supported claims. Extractive by
 * design: every sentence in it is a sentence some source actually published.
 */
function summarize(claims: Claim[], limit = 4): string {
  if (claims.length === 0) return "Bu soruya dair yeterli kaynak bulunamadı.";
  return claims
    .slice(0, limit)
    .map((c) => c.text)
    .join(" ");
}

/** Angles that produced little support are worth another, narrower search. */
function followUpQueries(sections: ResearchSection[], question: string, limit: number): string[] {
  const weak = sections
    .filter((s) => s.findings.length === 0 || s.findings[0].independentSources < 2)
    .map((s) => s.subQuestion);

  const terms = tokenize(question).slice(0, 4).join(" ");
  return weak
    .slice(0, limit)
    .map((sub) => (terms && !sub.includes(terms) ? `${sub} ${terms}` : `${sub} kaynak`));
}

export async function runResearch(
  question: string,
  options: ResearchOptions = {}
): Promise<ResearchReport> {
  const started = Date.now();
  const trimmed = question.trim();
  if (!trimmed) throw new CloudaError("invalid_request", "Araştırma sorusu boş olamaz.");
  if (trimmed.length > 500) throw new CloudaError("query_too_long", "Soru 500 karakteri aşamaz.");

  const depth = (options.depth ?? "standard") as ResearchDepth;
  const profile = RESEARCH_DEPTHS[depth];
  if (!profile) throw new CloudaError("invalid_request", `Bilinmeyen derinlik: ${depth}`);

  const budget: ResearchBudget = {
    maxSources: Math.min(options.maxSources ?? profile.maxSources, 40),
    maxSearches: profile.subQuestions + profile.rounds * 2,
    maxDurationMs: Math.min(options.maxDurationMs ?? 60_000, 120_000),
  };

  const intent = detectIntent(trimmed);
  const basePlan = planQuery(trimmed, { freshnessHours: options.freshnessHours });
  const subQuestions = decompose(trimmed, profile.subQuestions, intent);

  const collected: SearchResult[] = [];
  const sections: ResearchSection[] = [];
  let searches = 0;
  let rounds = 0;
  let budgetExhausted = false;

  const outOfBudget = () =>
    Date.now() - started > budget.maxDurationMs ||
    searches >= budget.maxSearches ||
    collected.length >= budget.maxSources;

  const searchOne = async (q: string): Promise<SearchResult[]> => {
    searches++;
    const res = await searchWeb(q, {
      maxResults: Math.max(3, Math.ceil(budget.maxSources / profile.subQuestions)),
      locale: options.locale,
      freshnessHours: options.freshnessHours ?? basePlan.suggestedFreshnessHours,
      domainPolicy: options.domainPolicy,
      includeContent: true,
    });
    return res.results;
  };

  // Round 1: one search per angle.
  rounds++;
  for (const sub of subQuestions) {
    if (outOfBudget()) {
      budgetExhausted = true;
      break;
    }
    const results = await searchOne(sub);
    collected.push(...results);

    const verification = verifyClaims(results, { query: sub, maxClaims: 4 });
    sections.push({
      subQuestion: sub,
      summary: summarize(verification.claims, 2),
      findings: verification.claims,
      sourceUrls: results.map((r) => r.url),
    });
  }

  // Later rounds: revisit the angles that came back thin.
  for (let round = 1; round < profile.rounds; round++) {
    if (outOfBudget()) {
      budgetExhausted = true;
      break;
    }
    const followUps = followUpQueries(sections, trimmed, 2);
    if (followUps.length === 0) break;

    rounds++;
    for (const follow of followUps) {
      if (outOfBudget()) {
        budgetExhausted = true;
        break;
      }
      const results = await searchOne(follow);
      collected.push(...results);

      const section = sections.find((s) => follow.startsWith(s.subQuestion));
      if (section) {
        const merged = dedupeByUrl([
          ...results,
          ...collected.filter((c) => section.sourceUrls.includes(c.url)),
        ]);
        const verification = verifyClaims(merged, { query: section.subQuestion, maxClaims: 4 });
        section.findings = verification.claims;
        section.summary = summarize(verification.claims, 2);
        section.sourceUrls = Array.from(new Set([...section.sourceUrls, ...results.map((r) => r.url)]));
      }
    }
  }

  const allSources = dedupeByUrl(collected).slice(0, budget.maxSources);

  // Verify once more across everything, so cross-angle agreement counts.
  const overall = verifyClaims(allSources, { query: trimmed, maxClaims: 15, minQueryOverlap: 0.12 });

  const usedFor = new Map<string, string[]>();
  for (const section of sections) {
    for (const url of section.sourceUrls) {
      const list = usedFor.get(url) ?? [];
      if (!list.includes(section.subQuestion)) list.push(section.subQuestion);
      usedFor.set(url, list);
    }
  }

  const gaps = sections
    .filter((s) => s.findings.length === 0)
    .map((s) => `"${s.subQuestion}" için doğrulanabilir kaynak bulunamadı.`);

  return {
    question: trimmed,
    depth,
    plan: subQuestions,
    summary: summarize(overall.claims, 5),
    sections,
    keyFindings: overall.claims,
    conflicts: overall.contested,
    sources: allSources.map((s) => ({
      url: s.url,
      title: s.title,
      publishedAt: s.publishedAt,
      credibility: s.scores.credibility,
      usedFor: usedFor.get(s.url) ?? [],
    })),
    stats: {
      searches,
      sourcesExamined: allSources.length,
      rounds,
      durationMs: Date.now() - started,
      budgetExhausted,
    },
    gaps,
  };
}
