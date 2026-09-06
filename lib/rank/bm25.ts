/**
 * BM25 ranking over documents the caller supplies.
 *
 * Everything else in this product ranks pages we fetched. An agent doing
 * retrieval has the opposite problem: it already has fifty candidate passages
 * from its own vector store and needs to know which five to put in a prompt.
 * Vector similarity is bad at that last step — it is trained to find things
 * that are *about* the same subject, which is why it happily returns a passage
 * about Postgres indexes for a question about a specific error message.
 *
 * BM25 is the standard lexical answer, it is cheap, and it needs no model. The
 * whole thing runs in memory over the caller's own text: no network, no page
 * fetch, and no embedding service in the path.
 *
 * The parameters are the usual ones. k1 controls how fast term frequency
 * saturates — a document that says "index" nine times is not nine times more
 * about indexes than one that says it once. b controls length normalisation:
 * at 0.75 a long document is discounted for its length but not erased by it.
 */

const K1 = 1.2;
const B = 0.75;

/** Terms so common in either language that they separate nothing. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by",
  "for", "with", "about", "is", "are", "was", "were", "be", "been", "it", "this",
  "that", "as", "from", "not", "no", "do", "does", "did", "can", "will", "would",
  "ve", "veya", "ile", "icin", "bir", "bu", "su", "o", "de", "da", "ki", "mi",
  "mu", "ama", "fakat", "gibi", "kadar", "daha", "cok", "az", "olan", "olarak",
]);

/**
 * Turkish suffixes, longest first so "larindan" is not eaten as "dan".
 * Deliberately shallow: a real morphological analyser is a large dependency
 * and the gain over this on short queries is small.
 */
const TR_SUFFIX = new RegExp(
  "(" +
    [
      "larindan", "lerinden", "larimiz", "lerimiz", "lariniz", "leriniz",
      "lardan", "lerden", "larin", "lerin", "lari", "leri", "lar", "ler",
      "imiz", "iniz", "umuz", "unuz", "sin", "sun", "dir", "dur", "tir", "tur",
      "nin", "nun", "in", "un", "im", "um", "ye", "ya", "de", "da", "te", "ta",
      "den", "dan", "ten", "tan", "le", "la", "ce", "ca", "si", "su", "i", "u",
      "e", "a",
    ].join("|") +
    ")$"
);

/** English suffixes, applied only when what is left is still a word. */
const EN_SUFFIX = /(ational|iveness|fulness|ousness|ization|ation|ingly|edly|ies|ied|ing|ers|er|est|ed|es|s|ly)$/;

/**
 * A plural "s" is not every trailing "s". Stripping it from "address" gives
 * "addres", while "addresses" loses "es" and gives "address" — so the same
 * word in a query and in a document stemmed to two different things and never
 * matched. The classic exceptions are a doubled s, and the Latin -us/-is
 * endings that are singular already.
 */
const NOT_A_PLURAL = /(ss|us|is)$/;

/**
 * English doubles a final consonant before a vowel suffix — run/running,
 * stop/stopped — so stripping the suffix leaves "runn" and "stopp", which
 * match neither the base word nor each other. l, s and z are left alone
 * because they double in words that are already whole: fall, pass, buzz.
 */
const DOUBLED_END = /([^aeiouls z])\1$/;

function fold(word: string): string {
  return word
    .toLowerCase()
    .replace(/[ıİ]/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function stem(word: string): string {
  const folded = fold(word);
  if (folded.length <= 4) return folded;

  const tr = folded.replace(TR_SUFFIX, "");
  if (tr.length >= 3 && tr !== folded) return tr;

  if (NOT_A_PLURAL.test(folded) && /s$/.test(folded) && !/(ies|ses|xes|zes|ches|shes)$/.test(folded)) {
    return folded;
  }

  // -ies and -ied come from a -y, so they have to be put back rather than
  // simply cut: "queries" cut to "quer" matches nothing, "queries" restored to
  // "query" matches the word the caller typed.
  if (/[^aeiou]ies$/.test(folded)) return folded.replace(/ies$/, "y");
  if (/[^aeiou]ied$/.test(folded)) return folded.replace(/ied$/, "y");

  const en = folded.replace(EN_SUFFIX, "");
  if (en.length < 3) return folded;
  return en.replace(DOUBLED_END, "$1");
}

export function tokenize(text: string): string[] {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) ?? [])
    .map((raw) => raw.replace(/^[.\-_]+|[.\-_]+$/g, ""))
    .filter((raw) => raw.length >= 2)
    .map(stem)
    .filter((term) => term.length >= 2 && !STOP.has(term));
}

export interface RankDocument {
  id: string;
  /** Weighted higher than the body, since a title states the subject. */
  title?: string;
  text: string;
  /** Passed through untouched, so a caller can carry its own bookkeeping. */
  metadata?: Record<string, unknown>;
}

export interface RankedDocument {
  id: string;
  score: number;
  /** 0-1, the score divided by the best score in this set. */
  relative: number;
  /** Query terms this document actually contains, in query order. */
  matchedTerms: string[];
  /** The passage that best covers the query, for a citation or a preview. */
  bestPassage: string | null;
  metadata?: Record<string, unknown>;
}

/** How much a term in the title counts relative to one in the body. */
const TITLE_WEIGHT = 2.5;

interface Indexed {
  doc: RankDocument;
  /** Term -> weighted count. */
  frequencies: Map<string, number>;
  length: number;
}

function indexDocument(doc: RankDocument): Indexed {
  const frequencies = new Map<string, number>();
  let length = 0;

  const add = (text: string, weight: number) => {
    for (const term of tokenize(text)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + weight);
      length += weight;
    }
  };

  add(doc.text, 1);
  if (doc.title) add(doc.title, TITLE_WEIGHT);

  return { doc, frequencies, length };
}

/**
 * Picks the window of the document that covers the most query terms.
 *
 * A score without evidence is not much use to an agent that has to justify an
 * answer, and the whole document is usually too long to quote. The window is
 * sentence-aligned so what comes back reads as prose rather than a slice.
 */
function bestPassage(text: string, terms: Set<string>, maxChars: number): string | null {
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return null;

  let best = { start: 0, end: 1, hits: -1, length: 0 };

  for (let start = 0; start < sentences.length; start++) {
    const seen = new Set<string>();
    let length = 0;

    for (let end = start; end < sentences.length; end++) {
      length += sentences[end].length + 1;
      if (length > maxChars && end > start) break;

      for (const term of tokenize(sentences[end])) {
        if (terms.has(term)) seen.add(term);
      }

      // Prefer more distinct terms; break ties toward the shorter window.
      if (seen.size > best.hits || (seen.size === best.hits && length < best.length)) {
        best = { start, end: end + 1, hits: seen.size, length };
      }
    }
  }

  if (best.hits <= 0) return sentences.slice(0, 2).join(" ").slice(0, maxChars) || null;
  return sentences.slice(best.start, best.end).join(" ").slice(0, maxChars);
}

export interface RankOptions {
  /** Trade relevance against variety; 0 is pure relevance, 1 pure novelty. */
  diversity?: number;
  topK?: number;
  passageChars?: number;
}

/**
 * Maximal marginal relevance.
 *
 * Ten passages from the same document all answer the question and only one of
 * them adds anything to a prompt. MMR picks the next document by its own score
 * minus how much it repeats what has already been picked, which is the
 * difference between a context window full of information and one full of the
 * same paragraph.
 */
function overlap(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  for (const term of smaller.keys()) if (larger.has(term)) shared += 1;
  const denominator = Math.min(smaller.size, larger.size);
  return denominator === 0 ? 0 : shared / denominator;
}

export function rank(
  query: string,
  documents: RankDocument[],
  options: RankOptions = {}
): RankedDocument[] {
  const queryTerms = tokenize(query);
  const topK = Math.min(options.topK ?? documents.length, documents.length);
  const passageChars = options.passageChars ?? 320;
  const diversity = Math.min(1, Math.max(0, options.diversity ?? 0));

  if (documents.length === 0) return [];

  const indexed = documents.map(indexDocument);
  const avgLength = indexed.reduce((sum, d) => sum + d.length, 0) / indexed.length || 1;

  // Document frequency per query term, over this set only. The caller's set is
  // the corpus — there is no global index and pretending otherwise would make
  // the scores meaningless.
  const documentFrequency = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    documentFrequency.set(term, indexed.filter((d) => d.frequencies.has(term)).length);
  }

  const scored = indexed.map((entry) => {
    let score = 0;
    const matched: string[] = [];

    for (const term of queryTerms) {
      const frequency = entry.frequencies.get(term);
      if (!frequency) continue;
      if (!matched.includes(term)) matched.push(term);

      const n = documentFrequency.get(term) ?? 0;
      // Robertson/Sparck-Jones idf with the +1 that keeps it non-negative.
      const idf = Math.log(1 + (indexed.length - n + 0.5) / (n + 0.5));
      const norm = frequency * (K1 + 1);
      const denominator = frequency + K1 * (1 - B + (B * entry.length) / avgLength);
      score += idf * (norm / denominator);
    }

    return { entry, score, matched };
  });

  const bestScore = Math.max(...scored.map((s) => s.score), 0);

  const shape = (s: (typeof scored)[number]): RankedDocument => ({
    id: s.entry.doc.id,
    score: Number(s.score.toFixed(4)),
    relative: bestScore > 0 ? Number((s.score / bestScore).toFixed(4)) : 0,
    matchedTerms: s.matched,
    bestPassage: bestPassage(
      s.entry.doc.title ? `${s.entry.doc.title}. ${s.entry.doc.text}` : s.entry.doc.text,
      new Set(queryTerms),
      passageChars
    ),
    ...(s.entry.doc.metadata ? { metadata: s.entry.doc.metadata } : {}),
  });

  if (diversity === 0) {
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(shape);
  }

  // MMR only reorders documents that actually match.
  //
  // Measured, and it is the classic failure of this algorithm: asked for two
  // diverse results about index bloat, it returned the right document and then
  // a recipe for pasta. A document with no query terms in it has nothing to be
  // redundant with, so its novelty term is a perfect zero — and against a
  // strong diversity weight, zero beats any real candidate's penalty.
  // Irrelevance is not novelty. Documents that matched nothing are ranked
  // behind everything that did, and only fill the quota if it is unfilled.
  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const irrelevant = scored.filter((s) => s.score <= 0).sort((a, b) => b.score - a.score);

  const pool = relevant;
  const picked: typeof pool = [];

  while (picked.length < topK && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const normalised = bestScore > 0 ? candidate.score / bestScore : 0;
      const redundancy = picked.length
        ? Math.max(...picked.map((p) => overlap(candidate.entry.frequencies, p.entry.frequencies)))
        : 0;
      const value = (1 - diversity) * normalised - diversity * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    picked.push(pool.splice(bestIndex, 1)[0]);
  }

  return [...picked, ...irrelevant].slice(0, topK).map(shape);
}
