import { countWords, type ParsedSegment } from "./parse";

// Retrieval units for Ask Meetscribe: 150 to 250 words, split on speaker turns (SPEC.md section 4).
// Each turn keeps its "Speaker: " prefix so a retrieved chunk reads as dialogue and can be quoted.

export type Chunk = {
  segFrom: number;
  segTo: number;
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
  wordCount: number;
};

export const CHUNK_MIN_WORDS = 150;
export const CHUNK_MAX_WORDS = 250;

/** A monologue longer than one chunk is cut at sentence ends, with offsets interpolated by word position. */
function splitLongSegment(seg: ParsedSegment): ParsedSegment[] {
  const total = countWords(seg.text);
  if (total <= CHUNK_MAX_WORDS) return [seg];

  const sentences = seg.text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [seg.text];
  // A "sentence" with no punctuation can itself be too long; fall back to fixed word windows.
  const units = sentences.flatMap((s) => {
    const w = s.trim().split(/\s+/);
    if (w.length <= CHUNK_MAX_WORDS) return [s.trim()];
    return Array.from({ length: Math.ceil(w.length / CHUNK_MAX_WORDS) }, (_, i) => w.slice(i * CHUNK_MAX_WORDS, (i + 1) * CHUNK_MAX_WORDS).join(" "));
  });

  const pieces: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const unit of units) {
    const n = countWords(unit);
    if (words > 0 && words + n > CHUNK_MAX_WORDS) {
      pieces.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(unit);
    words += n;
  }
  if (current.length) pieces.push(current.join(" "));

  const span = seg.endMs - seg.startMs;
  let seen = 0;
  return pieces.map((text, i) => {
    const startMs = seg.startMs + Math.round((seen / total) * span);
    seen += countWords(text);
    const endMs = i === pieces.length - 1 ? seg.endMs : seg.startMs + Math.round((seen / total) * span);
    return { ...seg, text, startMs, endMs };
  });
}

export function chunkSegments(segments: ParsedSegment[]): Chunk[] {
  const chunks: Chunk[] = [];
  let group: ParsedSegment[] = [];
  let words = 0;

  const flush = () => {
    if (group.length === 0) return;
    chunks.push({
      segFrom: group[0].idx,
      segTo: group[group.length - 1].idx,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      speakerLabel: [...new Set(group.map((s) => s.speaker))].join(", "),
      text: group.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      wordCount: words,
    });
    group = [];
    words = 0;
  };

  for (const piece of segments.flatMap(splitLongSegment)) {
    const n = countWords(piece.text);
    if (words >= CHUNK_MIN_WORDS && words + n > CHUNK_MAX_WORDS) flush();
    // A piece that would overflow a still-small group: close the group early rather than exceed the cap.
    else if (words > 0 && words + n > CHUNK_MAX_WORDS) flush();
    group.push(piece);
    words += n;
    if (words >= CHUNK_MAX_WORDS) flush();
  }
  flush();
  return chunks;
}
