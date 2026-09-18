import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Citation } from "@/db/schema";
import { NOT_FOUND, bestSegment, sentenceAround, validateAnswer } from "./citations";
import type { Source } from "./retrieve";

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const ASK_SYSTEM = `You answer questions about the user's own meetings, using only the numbered sources below. Each source is an excerpt from a meeting transcript, or from the user's own Scratchpad notes for that meeting.

Rules:
- Use only the sources. Never use outside knowledge and never guess. If the sources do not contain the answer, reply with exactly: ${NOT_FOUND}
- If they answer only part of the question, answer that part and say plainly what is missing.
- End every sentence that states a fact with the number of the source it came from, in square brackets, like [2]. Use several when needed, like [1][4]. Only use numbers that appear below. Never cite a source for something it does not say.
- Report what people said, did or agreed to do. Do not describe what someone's job title implies they do: "she is the project manager" does not support "she will coordinate the schedule".
- Keep numbers, dates, names and wording exactly as they appear in the sources. Transcripts contain speech errors: if a figure is garbled or unclear, say it is unclear rather than tidying it into a precise number.
- When sources come from different meetings, put them in time order and say which meeting each point is from, so a change over time is visible.
- When a Scratchpad note disagrees with a transcript, the note is the owner's correction: state the corrected fact and mention that it comes from their notes.
- Be direct. Lead with the answer. 2 to 6 sentences, or a short list when the question asks for several things. No preamble, no closing remarks.`;

export function buildAskPrompt(question: string, sources: Source[], history: { question: string; answer: string }[]): string {
  const blocks = sources.map((s) => {
    const where = s.kind === "note" ? "the user's Scratchpad notes for" : "transcript of";
    return `[${s.n}] From ${where} "${s.meetingTitle}" (${dateFmt.format(new Date(s.meetingDate))})\n${s.text}`;
  });
  const earlier = history.length
    ? `Earlier in this conversation:\n${history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join("\n")}\n\n`
    : "";
  return `${earlier}Sources:\n\n${blocks.join("\n\n")}\n\nQuestion: ${question}`;
}

/**
 * Validates the finished answer and turns each surviving [n] into a citation that opens the exact transcript
 * line: the segment inside source n that best matches the sentence the marker sits in.
 */
export async function finalizeAnswer(raw: string, sources: Source[]): Promise<{ text: string; citations: Citation[]; removed: number; grounded: boolean }> {
  const validated = validateAnswer(raw, sources.length);
  const citations: Citation[] = [];

  for (const n of validated.cited) {
    const source = sources[n - 1];
    const marker = validated.text.indexOf(`[${n}]`);
    const sentence = sentenceAround(validated.text, marker);

    if (source.kind === "note" || source.segFrom === null || source.segTo === null) {
      citations.push({ n, meeting_id: source.meetingId, chunk_id: source.id, start_ms: -1, speaker: "Scratchpad", quote: source.text.slice(0, 280) });
      continue;
    }
    const segments = await db
      .select({ idx: schema.transcriptSegments.idx, speaker: schema.transcriptSegments.speaker, startMs: schema.transcriptSegments.startMs, text: schema.transcriptSegments.text })
      .from(schema.transcriptSegments)
      .where(and(eq(schema.transcriptSegments.meetingId, source.meetingId), gte(schema.transcriptSegments.idx, source.segFrom), lte(schema.transcriptSegments.idx, source.segTo)))
      .orderBy(schema.transcriptSegments.idx);
    const line = bestSegment(sentence, segments);
    citations.push({
      n,
      meeting_id: source.meetingId,
      chunk_id: source.id,
      start_ms: line?.startMs ?? source.startMs ?? 0,
      speaker: line?.speaker ?? source.speakerLabel,
      quote: (line?.text ?? source.text).slice(0, 280),
    });
  }
  return { text: validated.text, citations, removed: validated.removed, grounded: validated.grounded };
}
