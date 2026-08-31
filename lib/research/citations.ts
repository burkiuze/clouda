import { normalize, tokenize } from "@/lib/search/query";
import type { SearchResult } from "@/lib/search/types";

/**
 * Claim extraction and cross-source verification.
 *
 * The goal is narrow and honest: rather than asserting what is true, the API
 * reports which sources say the same thing, which say something incompatible,
 * and how much independent support each statement has. A model can then cite
 * rather than assert, which is where most hallucination comes from.
 *
 * Everything here is extractive — claims are sentences that appear verbatim in
 * a fetched source, never generated — so a citation always points at text that
 * genuinely exists at that URL.
 */

export interface Citation {
  url: string;
  title: string;
  /** The sentence in that source which supports the claim. */
  quote: string;
  credibility: number;
  publishedAt: string | null;
}

export interface Claim {
  id: string;
  text: string;
  citations: Citation[];
  /** Sources that state something incompatible with this claim. */
  conflicts: Citation[];
  /** Number of distinct hosts backing the claim. */
  independentSources: number;
  /** 0-1; rises with independent support and source credibility. */
  confidence: number;
  /** Why the confidence landed where it did. */
  basis: string[];
}

export interface VerificationReport {
  claims: Claim[];
  /** Claims whose sources disagree, surfaced separately for convenience. */
  contested: Claim[];
  sourcesUsed: number;
}

const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"'])/;

/** Sentences that assert something checkable rather than narrate or invite. */
const FACTUAL_MARKERS = [
  /\d/, // numbers, dates, percentages, money
  /\b(göre|bildirdi|açıkladı|duyurdu|oldu|olacak|arttı|azaldı|yüzde)\b/i,
  /\b(according to|reported|announced|said|rose|fell|percent|study found|is the)\b/i,
];

const NOISE_MARKERS = [
  /\b(çerez|cookie|abone ol|subscribe|newsletter|gizlilik politikası|privacy policy|tüm hakları)\b/i,
  /\b(share this|read more|advertisement|sign in|log in)\b/i,
];

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_SPLIT))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 45 && s.length <= 400)
    .filter((s) => !NOISE_MARKERS.some((n) => n.test(s)));
}

function isFactual(sentence: string): boolean {
  return FACTUAL_MARKERS.some((m) => m.test(sentence));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
}

/** Jaccard overlap on content words; cheap and good enough to pair sentences. */
function similarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

/** Two sentences about the same thing that state different figures conflict. */
function contradicts(a: string, b: string): boolean {
  if (similarity(a, b) < 0.45) return false;

  const numsA = (normalize(a).match(NUMBER_RE) ?? []).map((n) => n.replace(",", "."));
  const numsB = (normalize(b).match(NUMBER_RE) ?? []).map((n) => n.replace(",", "."));

  if (numsA.length > 0 && numsB.length > 0) {
    const setB = new Set(numsB);
    // Same subject, entirely different figures.
    if (!numsA.some((n) => setB.has(n))) return true;
  }

  // One asserts, the other negates.
  const negA = /\b(değil|yok|olmadı|reddetti|not|no longer|denied|false)\b/i.test(a);
  const negB = /\b(değil|yok|olmadı|reddetti|not|no longer|denied|false)\b/i.test(b);
  return negA !== negB && similarity(a, b) > 0.6;
}

export interface VerifyOptions {
  /** Question the claims should be relevant to. */
  query: string;
  maxClaims?: number;
  /** Minimum overlap with the query before a sentence is considered. */
  minQueryOverlap?: number;
}

export function verifyClaims(
  results: SearchResult[],
  options: VerifyOptions
): VerificationReport {
  const maxClaims = options.maxClaims ?? 12;
  const minOverlap = options.minQueryOverlap ?? 0.2;

  // Collect candidate sentences with the source they came from.
  const candidates: { sentence: string; result: SearchResult }[] = [];
  for (const result of results) {
    const text = result.content || result.snippet;
    if (!text) continue;
    for (const sentence of sentences(text)) {
      if (!isFactual(sentence)) continue;
      if (similarity(sentence, options.query) < minOverlap) continue;
      candidates.push({ sentence, result });
    }
  }

  // Group near-identical sentences: each group becomes one claim, and the
  // number of distinct hosts in it is the independent support.
  const groups: { text: string; members: { sentence: string; result: SearchResult }[] }[] = [];
  for (const candidate of candidates) {
    const group = groups.find((g) => similarity(g.text, candidate.sentence) >= 0.62);
    if (group) {
      group.members.push(candidate);
    } else {
      groups.push({ text: candidate.sentence, members: [candidate] });
    }
  }

  // Prefer claims with the widest independent backing.
  groups.sort((a, b) => {
    const hostsA = new Set(a.members.map((m) => hostOf(m.result.url))).size;
    const hostsB = new Set(b.members.map((m) => hostOf(m.result.url))).size;
    if (hostsB !== hostsA) return hostsB - hostsA;
    return b.members.length - a.members.length;
  });

  const claims: Claim[] = groups.slice(0, maxClaims).map((group, index) => {
    const byHost = new Map<string, { sentence: string; result: SearchResult }>();
    for (const member of group.members) {
      const host = hostOf(member.result.url);
      const existing = byHost.get(host);
      if (!existing || member.result.scores.credibility > existing.result.scores.credibility) {
        byHost.set(host, member);
      }
    }

    const citations: Citation[] = Array.from(byHost.values()).map((m) => ({
      url: m.result.url,
      title: m.result.title,
      quote: m.sentence,
      credibility: m.result.scores.credibility,
      publishedAt: m.result.publishedAt,
    }));

    // Look for sentences elsewhere that contradict this claim.
    const conflicts: Citation[] = [];
    const claimHosts = new Set(citations.map((c) => hostOf(c.url)));
    for (const candidate of candidates) {
      const host = hostOf(candidate.result.url);
      if (claimHosts.has(host)) continue;
      if (conflicts.some((c) => hostOf(c.url) === host)) continue;
      if (contradicts(group.text, candidate.sentence)) {
        conflicts.push({
          url: candidate.result.url,
          title: candidate.result.title,
          quote: candidate.sentence,
          credibility: candidate.result.scores.credibility,
          publishedAt: candidate.result.publishedAt,
        });
      }
    }

    const independentSources = citations.length;
    const avgCredibility =
      citations.reduce((sum, c) => sum + c.credibility, 0) / Math.max(1, citations.length);

    const basis: string[] = [];
    // Support saturates: three independent sources is strong, ten is not
    // three times stronger.
    let confidence = 1 - Math.pow(0.55, independentSources);
    basis.push(`${independentSources} bağımsız kaynak`);

    confidence = confidence * (0.55 + 0.45 * avgCredibility);
    basis.push(`ortalama güvenilirlik ${avgCredibility.toFixed(2)}`);

    if (conflicts.length > 0) {
      confidence *= Math.max(0.35, 1 - 0.25 * conflicts.length);
      basis.push(`${conflicts.length} çelişen kaynak`);
    }

    return {
      id: `claim_${index + 1}`,
      text: group.text,
      citations,
      conflicts,
      independentSources,
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
      basis,
    };
  });

  return {
    claims,
    contested: claims.filter((c) => c.conflicts.length > 0),
    sourcesUsed: new Set(results.map((r) => hostOf(r.url))).size,
  };
}
