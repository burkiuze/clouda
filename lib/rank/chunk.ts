/**
 * Splits long text into passages a model can be given.
 *
 * The naive version of this — cut every N characters — is why so much
 * retrieval is bad: it splits sentences in half, separates a heading from the
 * paragraph it introduces, and cuts tables down the middle, so a chunk arrives
 * at the model as a fragment with no idea what it is about.
 *
 * This splits on the structure the text already has, in descending order of
 * how strong the boundary is: headings, then blank lines, then sentences, and
 * only inside an unbroken wall of text does it fall back to a hard cut. Each
 * chunk carries the heading trail above it, so a passage that says "it must be
 * rebuilt concurrently" still knows it is under "Reindexing".
 */

export interface Chunk {
  index: number;
  text: string;
  /** Heading trail above this chunk, outermost first. */
  headings: string[];
  chars: number;
  /** Rough token count: English averages ~4 chars per token, Turkish fewer. */
  estimatedTokens: number;
  /** Character offsets into the original text. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Target size in characters. */
  size?: number;
  /** Characters of the previous chunk repeated at the start of the next. */
  overlap?: number;
  /** Prepend the heading trail to each chunk's text, for standalone use. */
  includeHeadings?: boolean;
}

const DEFAULT_SIZE = 1200;
const DEFAULT_OVERLAP = 120;
/** A chunk shorter than this is glued to its neighbour rather than emitted. */
const MIN_CHUNK = 80;

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
/** A short standalone line in title case, which is how HTML-to-text marks headings. */
const IMPLIED_HEADING = /^[^\n.!?]{3,80}$/;

interface Block {
  text: string;
  start: number;
  headings: string[];
}

function splitIntoBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  const trail: { depth: number; title: string }[] = [];

  let buffer: string[] = [];
  let bufferStart = 0;
  let offset = 0;

  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (joined) {
      blocks.push({ text: joined, start: bufferStart, headings: trail.map((t) => t.title) });
    }
    buffer = [];
  };

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    const markdown = line.match(MARKDOWN_HEADING);
    if (markdown) {
      flush();
      const depth = markdown[1].length;
      while (trail.length > 0 && trail[trail.length - 1].depth >= depth) trail.pop();
      trail.push({ depth, title: markdown[2].trim() });
      bufferStart = offset;
      continue;
    }

    // A short line alone between blank lines, with no terminal punctuation, is
    // how a heading survives conversion from HTML. Treated as a boundary but
    // not as a level, since its depth is unknowable.
    const trimmed = line.trim();
    if (trimmed && buffer.length === 0 && IMPLIED_HEADING.test(trimmed) && !/[.!?:;,]$/.test(trimmed)) {
      flush();
      while (trail.length > 1) trail.pop();
      if (trail.length === 1) trail.pop();
      trail.push({ depth: 1, title: trimmed });
      bufferStart = offset;
      continue;
    }

    if (trimmed === "") {
      flush();
      bufferStart = offset;
      continue;
    }

    if (buffer.length === 0) bufferStart = lineStart;
    buffer.push(line);
  }
  flush();

  return blocks;
}

/** Sentence boundaries, keeping the terminator with the sentence it ends. */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/);
  return parts.length > 1 ? parts : [text];
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const size = Math.max(200, options.size ?? DEFAULT_SIZE);
  const overlap = Math.max(0, Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(size / 2)));
  const normalised = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");

  const blocks = splitIntoBlocks(normalised);
  const chunks: Chunk[] = [];

  let current: { parts: string[]; headings: string[]; start: number; length: number } | null = null;

  const emit = () => {
    if (!current) return;
    const body = current.parts.join("\n\n").trim();
    if (!body) {
      current = null;
      return;
    }

    // Carry the tail of the previous chunk forward, so a sentence that spans a
    // boundary is complete in at least one of the two.
    const previous = chunks[chunks.length - 1];
    const carried =
      overlap > 0 && previous && previous.headings.join("/") === current.headings.join("/")
        ? previous.text.slice(-overlap)
        : "";

    const withHeadings =
      options.includeHeadings && current.headings.length > 0
        ? `${current.headings.join(" › ")}\n\n${carried}${carried ? " " : ""}${body}`
        : `${carried}${carried ? " " : ""}${body}`;

    chunks.push({
      index: chunks.length,
      text: withHeadings,
      headings: current.headings,
      chars: withHeadings.length,
      estimatedTokens: Math.ceil(withHeadings.length / 3.6),
      start: current.start,
      end: current.start + body.length,
    });
    current = null;
  };

  for (const block of blocks) {
    // A block bigger than a whole chunk is broken down on its own boundaries
    // before it is placed, so one long section does not become one long chunk.
    const pieces =
      block.text.length <= size
        ? [block.text]
        : splitSentences(block.text).flatMap((sentence) =>
            sentence.length <= size ? [sentence] : hardSplit(sentence, size)
          );

    for (const piece of pieces) {
      const headingsChanged =
        current !== null && current.headings.join("/") !== block.headings.join("/");

      if (current && (headingsChanged || current.length + piece.length > size)) {
        // Do not emit a scrap: fold it into what follows instead.
        if (current.length >= MIN_CHUNK || headingsChanged) emit();
      }

      if (!current) {
        current = { parts: [], headings: block.headings, start: block.start, length: 0 };
      }
      current.parts.push(piece);
      current.length += piece.length + 2;
    }
  }
  emit();

  return chunks;
}
