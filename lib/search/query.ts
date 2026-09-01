import { QueryIntent, QueryPlan } from "@/lib/search/types";

/**
 * Query understanding.
 *
 * Runs before any provider is called: it classifies what the caller is after,
 * cleans the query up for retrieval, decides whether the answer has to be
 * fresh, and — for research — splits the question into sub-questions.
 *
 * Deliberately deterministic. An LLM would classify better, but this layer is
 * on the hot path of every search, so it stays cheap and predictable; the
 * research orchestrator is where an optional model gets used.
 */

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "nedir", "nasil", "ne", "mi", "mu", "ile", "icin", "ve", "veya", "bir", "bu",
  "the", "what", "is", "are", "how", "to", "a", "an", "of", "for", "and", "in",
  "on", "at", "by", "with", "about", "from",
]);

/**
 * Words that say a query is about news rather than saying what about.
 *
 * They are stripped only once the intent has been decided from them, because
 * they are the signal that decides it. Leaving them in the search terms was
 * measured to cost real answers: "nepal sel felaketi son dakika" was matched
 * against headlines term by term, and no headline about the floods contains
 * the words "son dakika", so the story that answered the question failed the
 * match while the marker words did nothing but dilute it.
 */
const NEWS_MARKERS = new Set([
  "son", "dakika", "haber", "haberi", "haberler", "haberleri", "gundem",
  "guncel", "manset", "breaking", "news", "latest", "headlines", "update",
  "updates",
]);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

const INTENT_PATTERNS: { intent: QueryIntent; patterns: RegExp[] }[] = [
  {
    intent: "news",
    /**
     * Deliberately narrow. The looser version classified "envoy proxy circuit
     * breaking" as news because "breaking" appeared in it, which sent the
     * query to a news set with no Stack Exchange or GitHub in it and returned
     * two results instead of six. Words that are ordinary technical vocabulary
     * on their own — breaking, latest, update, release — only count as news
     * signals in a phrase that can mean nothing else.
     */
    patterns: [
      // Turkish agglutinates, so the suffix has to be allowed for: haber,
      // haberler, haberleri, gündemdeki. A fixed word boundary matched none
      // of the inflected forms people actually type.
      /\b(haber\w*|manşet\w*|gündem\w*)/i,
      /\bson dakika\b/i,
      /\b(breaking news|latest news|news about|in the news)\b/i,
      /\b(announced|announcement|press release)\b/i,
      /\b(bugün|bugun|dün|dun|this week|today|yesterday)\b/i,
    ],
  },
  {
    intent: "finance",
    patterns: [
      /\b(fiyat|kur|dolar|euro|borsa|hisse|faiz|enflasyon|kripto|bitcoin)\b/i,
      /\b(price|stock|shares|market cap|exchange rate|inflation|crypto)\b/i,
    ],
  },
  {
    intent: "product",
    patterns: [
      /\b(satin al|satın al|kac para|kaç para|indirim|model|ozellik|özellik|karsilastir|karşılaştır)\b/i,
      /\b(buy|review|vs\.?|compare|best|cheapest|specs|pricing)\b/i,
    ],
  },
  {
    intent: "academic",
    patterns: [
      /\b(makale|arastirma|araştırma|calisma|çalışma|literatur|literatür|tez|doi)\b/i,
      /\b(paper|study|research|journal|meta-analysis|preprint|arxiv)\b/i,
    ],
  },
  {
    intent: "technical",
    patterns: [
      /\b(hata|kod|kurulum|api|kutuphane|kütüphane|framework|derleme)\b/i,
      /\b(error|exception|install|npm|pip|docker|kubernetes|typescript|python|sdk|library)\b/i,
    ],
  },
];

export function detectIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(query))) return intent;
  }
  return "general";
}

const FRESHNESS_HINTS = [
  // "breaking" alone is not a recency signal — "circuit breaking" would have
  // pinned the results to the last hour and thrown away every canonical page.
  { pattern: /\b(son dakika|su an|şu an|right now|breaking news)\b/i, hours: 1 },
  { pattern: /\b(bugun|bugün|today|son 24 saat)\b/i, hours: 24 },
  { pattern: /\b(bu hafta|this week|son 7 gun|son 7 gün)\b/i, hours: 24 * 7 },
  { pattern: /\b(bu ay|this month|son 30 gun|son 30 gün)\b/i, hours: 24 * 30 },
  { pattern: /\b(20\d\d)\b/, hours: 24 * 365 },
];

function detectFreshness(query: string, intent: QueryIntent): number | null {
  for (const hint of FRESHNESS_HINTS) {
    if (hint.pattern.test(query)) return hint.hours;
  }
  // News and finance go stale by nature even when the wording doesn't say so.
  if (intent === "news") return 24;
  if (intent === "finance") return 6;
  return null;
}

/** Strips conversational padding that hurts keyword retrieval. */
/**
 * Turns a spoken question into something an index can match.
 *
 * Stripping question words matters more than it looks. Sources are keyword
 * indexes, not question answerers: "postgres index bloat nedir" found nothing
 * anywhere, because no page contains "nedir" next to those terms, while
 * "postgres index bloat" is answered several times over. Stopwords were
 * already defined but only ever used for scoring, so the query reaching the
 * providers still carried them.
 *
 * Diacritics are deliberately preserved — the tokeniser folds them for
 * comparison, but "vektör" is what the Turkish sources are indexed under.
 * And the stripped form is only used when enough content words survive: for a
 * query that is mostly function words, the original is the better query.
 */
function optimize(query: string, intent?: QueryIntent): string {
  const cleaned = query
    .replace(/^(bana|lutfen|lütfen|please|can you|could you|acaba)\s+/i, "")
    .replace(/\b(soyler misin|söyler misin|anlat|acikla|açıkla|tell me|explain)\b/gi, "")
    .replace(/[?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const drop = intent === "news" || intent === "finance" ? NEWS_MARKERS : null;

  const kept = cleaned
    .split(" ")
    .filter((word) => {
      if (!word) return false;
      const normalised = normalize(word);
      return !STOPWORDS.has(normalised) && !drop?.has(normalised);
    });

  // Falling back to the whole query matters most here: "son dakika" on its own
  // is a legitimate request for headlines, and stripping it would leave
  // nothing to search for.
  return kept.length >= 2 ? kept.join(" ") : cleaned;
}

function detectLanguage(query: string): string {
  if (/[çğıöşüÇĞİÖŞÜ]/.test(query)) return "tr";
  if (/\b(nedir|nasil|nasıl|kimdir|hangi|neden)\b/i.test(query)) return "tr";
  return "en";
}

/**
 * Splits a research question into angles worth searching separately.
 * Falls back to facet templates when the question has no natural conjunctions.
 */
export function decompose(question: string, max: number, intent: QueryIntent): string[] {
  const cleaned = optimize(question);

  // Explicit conjunctions are the strongest signal of separable parts.
  const parts = cleaned
    .split(/\s+(?:ve|veya|ile birlikte|and|or|as well as)\s+|[;,]\s+/i)
    .map((p) => p.trim())
    .filter((p) => tokenize(p).length >= 2);

  const subs = new Set<string>();
  if (parts.length > 1) parts.forEach((p) => subs.add(p));
  subs.add(cleaned);

  const facets: Record<QueryIntent, string[]> = {
    news: ["son gelişmeler", "arka plan", "tepkiler"],
    finance: ["güncel veriler", "geçmiş eğilim", "uzman yorumları"],
    product: ["özellikler", "fiyat", "alternatifler", "kullanıcı yorumları"],
    academic: ["bulgular", "yöntem", "eleştiriler"],
    technical: ["nasıl yapılır", "yaygın hatalar", "en iyi uygulamalar"],
    general: ["tanım", "nasıl çalışır", "avantajlar ve dezavantajlar", "örnekler"],
  };

  for (const facet of facets[intent]) {
    if (subs.size >= max) break;
    subs.add(`${cleaned} ${facet}`);
  }

  return Array.from(subs).slice(0, max);
}

export function planQuery(
  query: string,
  options: { subQuestions?: number; freshnessHours?: number | null } = {}
): QueryPlan {
  const intent = detectIntent(query);
  const optimized = optimize(query, intent) || query.trim();
  const suggested = detectFreshness(query, intent);
  const freshness = options.freshnessHours ?? suggested;

  return {
    original: query,
    optimized,
    intent,
    needsFreshness: freshness != null,
    suggestedFreshnessHours: suggested,
    subQueries:
      options.subQuestions && options.subQuestions > 1
        ? decompose(query, options.subQuestions, intent)
        : [optimized],
    language: detectLanguage(query),
  };
}
