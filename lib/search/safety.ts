/**
 * Second line of defence behind each upstream source's own safe-search flag.
 * Discovery sources occasionally return adult or spam results for unrelated
 * queries, and the public demo on the landing page must not surface those.
 * Deliberately narrow: it drops results whose host or title is unambiguously
 * adult, and leaves judgement calls to the upstream filter.
 */

const ADULT_HOST_PATTERNS = [
  /(^|\.)porn/i,
  /porno/i,
  /xvideos?/i,
  /xhamster/i,
  /xnxx/i,
  /redtube/i,
  /youporn/i,
  /pornhub/i,
  /brazzers/i,
  /onlyfans/i,
  /chaturbate/i,
  /camsoda/i,
  /(^|\.)sex(y|shop)?\./i,
  /escort/i,
  /hentai/i,
  /rule34/i,
];

const ADULT_TEXT_PATTERNS = [
  /\bporn(o|ô|hub)?\b/i,
  /\bxxx\b/i,
  /\bhentai\b/i,
  /\bescort\b/i,
  /\bnude?s?\b/i,
  /\bcamgirl/i,
];

export function isUnsafeResult(result: { title: string; url: string; snippet: string }): boolean {
  let host = "";
  try {
    host = new URL(result.url).hostname;
  } catch {
    return true;
  }

  if (ADULT_HOST_PATTERNS.some((re) => re.test(host))) return true;

  const text = `${result.title} ${result.snippet}`;
  return ADULT_TEXT_PATTERNS.some((re) => re.test(text));
}

export function filterUnsafe<T extends { title: string; url: string; snippet: string }>(
  results: T[]
): T[] {
  return results.filter((r) => !isUnsafeResult(r));
}
