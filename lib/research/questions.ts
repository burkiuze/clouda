/**
 * Telling a question from a statement.
 *
 * Deliberately dependency-free, for two reasons. It is pure text handling with
 * nothing to inject, and keeping it that way means it can be compiled and
 * tested on its own — the module it was extracted from reaches into the search
 * stack and cannot be.
 *
 * It exists because of a live failure. Asked what REINDEX CONCURRENTLY does,
 * the cited-answer endpoint opened with "Question: Considering the same
 * example taken in the above link, when we reindex..." — a Stack Overflow
 * question, quoted verbatim and served as the answer to itself.
 *
 * That is a structural hazard of extracting from Q&A sites rather than a
 * one-off: those sites are among the best sources here, and on a question page
 * the question is the single most on-topic passage there is, so it scores
 * above every real answer beneath it. A question returned as an answer is
 * worse than an empty response, because the caller cannot tell the difference.
 */

const INTERROGATIVE: RegExp[] = [
  /\?\s*$/,
  /^\s*(question|soru)\s*[:.]/i,
  // An interrogative opener with a question mark anywhere before the sentence
  // ends. The [^.!]* stops it spanning into the next sentence.
  /^\s*(how|what|why|when|where|which|who|can|does|do|is|are|should|would|could|has|have)\b[^.!]*\?/i,
  /^\s*(nasıl|neden|niçin|ne zaman|nerede|hangi|kim|mı|mi|mu|mü)\b[^.!]*\?/i,
  // Forum phrasing that asks for help without ever forming a question.
  /\b(any (idea|help|suggestions)|please help|i am trying to|i'm trying to|denedim ama)\b/i,
];

export function isQuestion(sentence: string): boolean {
  return INTERROGATIVE.some((pattern) => pattern.test(sentence));
}
