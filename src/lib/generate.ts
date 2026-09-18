import { z } from "zod";
import type { SummaryContent, TemplateSection } from "@/db/schema";
import { generateJSON, type Attempt } from "@/lib/llm";
import { formatOffset } from "@/lib/utils";

// Summary and action item generation.
//
// Grounding rule: the model never writes a timestamp. It cites transcript lines by their [index], and the
// server maps each index to that segment's real start offset. An index that does not exist is discarded,
// and a bullet left with no source (and not from the owner's notes) is dropped. A citation in the stored
// summary therefore always points at a real transcript segment.

export type SegmentInput = { idx: number; speaker: string; startMs: number; text: string };

function renderTranscript(segments: SegmentInput[]): string {
  return segments.map((s) => `[${s.idx}] (${formatOffset(s.startMs)}) ${s.speaker}: ${s.text}`).join("\n");
}

function notesBlock(notes: string | null | undefined): string {
  if (!notes?.trim()) return "";
  return `\n\n<owner_notes>\n${notes.trim()}\n</owner_notes>`;
}

const NOTES_RULES = `The meeting owner may have written notes, given in <owner_notes>. They are corrections and additions from someone who was in the room.
- When the notes contradict the transcript (a name, number, date, decision), the notes are right. Write the corrected fact.
- When the notes add something the transcript lacks, include it where it belongs.
- Set from_notes to true on every bullet the notes changed or added. Otherwise false.
- A bullet that comes only from the notes may have an empty source_segments list.`;

// --------------------------------------------------------------------- summary

const summaryOutput = z.object({
  meeting_title: z.string().describe("A specific 3 to 8 word title for this meeting. No date, no 'Meeting about'."),
  overview: z.string().describe("2 to 3 sentences: what the meeting was for and how it ended."),
  sections: z.array(
    z.object({
      key: z.string(),
      bullets: z.array(
        z.object({
          text: z.string(),
          source_segments: z.array(z.number().int()).describe("Indices of the transcript lines that support this bullet"),
          from_notes: z.boolean(),
        }),
      ),
    }),
  ),
});

export type GeneratedSummary = {
  content: SummaryContent;
  title: string;
  model: string;
  attempts: Attempt[];
  stats: { bullets: number; droppedUngrounded: number; invalidCitations: number };
};

export async function generateSummary(input: {
  segments: SegmentInput[];
  sections: TemplateSection[];
  templateName: string;
  notes?: string | null;
}): Promise<GeneratedSummary> {
  const hasNotes = Boolean(input.notes?.trim());
  const system = `You write meeting summaries for people who were not in the meeting and need to act on it.

The transcript is given one line per turn as: [index] (time) Speaker: text

Rules:
- Use only what is in the transcript${hasNotes ? " and the owner's notes" : ""}. Never add outside knowledge, guesses or advice.
- Every bullet must list in source_segments the [index] numbers of the lines it is based on. Use 1 to 4 indices, the most specific ones. Only use indices that appear in the transcript.
- Attribute statements to the person who made them, by name, when it matters who said it.
- Keep numbers, dates, names and product terms exactly as spoken.
- One idea per bullet, one or two sentences, plain language, no filler such as "the team discussed".
- If a section has nothing real to report, return it with an empty bullets list. Do not pad.
- Transcripts from speech recognition contain errors and filler. Read through them; do not quote the noise.
${hasNotes ? NOTES_RULES : "- There are no owner notes. Set from_notes to false on every bullet."}

Produce exactly these sections, in this order, using these keys:
${input.sections.map((s) => `- key "${s.key}" (${s.title}): ${s.instruction}`).join("\n")}`;

  const { data, model, attempts } = await generateJSON({
    system,
    prompt: `Summary style: ${input.templateName}\n\n<transcript>\n${renderTranscript(input.segments)}\n</transcript>${notesBlock(input.notes)}`,
    schema: summaryOutput,
    effort: "low",
    timeoutMs: 50_000,
  });

  const startByIdx = new Map(input.segments.map((s) => [s.idx, s.startMs]));
  const wordsByIdx = new Map(input.segments.map((s) => [s.idx, s.text.split(/\s+/).filter(Boolean).length]));
  const stats = { bullets: 0, droppedUngrounded: 0, invalidCitations: 0 };

  const sections = input.sections.map((template) => {
    const produced = data.sections.find((s) => s.key === template.key);
    const bullets = (produced?.bullets ?? []).flatMap((b) => {
      const real = [...new Set(b.source_segments)].filter((i) => startByIdx.has(i));
      stats.invalidCitations += b.source_segments.length - real.length;
      // A line like "So" or "Okay" is a real segment but no evidence. Prefer substantive lines when there are any.
      const substantive = real.filter((i) => (wordsByIdx.get(i) ?? 0) > 2);
      const valid = (substantive.length ? substantive : real).slice(0, 4);
      const fromNotes = hasNotes && b.from_notes;
      if (valid.length === 0 && !fromNotes) {
        stats.droppedUngrounded++;
        return [];
      }
      stats.bullets++;
      return [{ text: b.text.trim(), source_ms: valid.map((i) => startByIdx.get(i)!).sort((a, z) => a - z), from_notes: fromNotes }];
    });
    return { key: template.key, title: template.title, bullets };
  });

  return { content: { overview: data.overview.trim(), sections }, title: data.meeting_title.trim(), model, attempts, stats };
}

// ---------------------------------------------------------------- action items

const actionOutput = z.object({
  items: z.array(
    z.object({
      task: z.string().describe("Starts with a verb. Self-contained: readable without the transcript."),
      assignee: z.string().nullable().describe("Exactly one of the participant names, or null when no owner was stated"),
      due_date: z.string().nullable().describe("YYYY-MM-DD, only when a deadline was stated. Otherwise null."),
      source_segments: z.array(z.number().int()).describe("1 to 3 indices of the lines that state the task and who owns it"),
    }),
  ),
});

export type GeneratedActionItem = { text: string; assigneeName: string | null; dueDate: string | null; sourceMs: number };

export async function generateActionItems(input: {
  segments: SegmentInput[];
  participants: string[];
  meetingDate: Date;
  notes?: string | null;
}): Promise<{ items: GeneratedActionItem[]; model: string; attempts: Attempt[]; dropped: number }> {
  const system = `You extract action items from a meeting transcript.

The transcript is given one line per turn as: [index] (time) Speaker: text

An action item is a piece of work someone is expected to do after the meeting. That includes:
- something a person says they will do ("I'll send the deck"),
- something a person is asked or assigned to do, including by a manager or chair handing out tasks. A brief or silent acceptance still counts; the assignment is what matters.
Not action items: things already done, general wishes, opinions, and topics that were only discussed.

Rules:
- assignee must be exactly one of these names, or null: ${input.participants.map((p) => JSON.stringify(p)).join(", ")}. When someone says "I'll do it", the assignee is that speaker.
- due_date only when a deadline was actually stated. The meeting took place on ${input.meetingDate.toISOString().slice(0, 10)} (${input.meetingDate.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" })}); resolve "Friday" or "next week" against that date. Otherwise null.
- source_segments are the [index] numbers of the 1 to 3 lines that say what is to be done and by whom, most informative first. This is only about which lines to cite: point at the line where the task is described, because a reply like "okay" tells a reader nothing. It does not change whether something is an action item. Only use indices that appear in the transcript.
- Merge duplicates. Order by when they came up. If there are none, return an empty list.${input.notes?.trim() ? "\n- The owner's notes in <owner_notes> correct the transcript. If they change an owner, a date or a task, use the corrected version." : ""}`;

  const { data, model, attempts } = await generateJSON({
    system,
    prompt: `<transcript>\n${renderTranscript(input.segments)}\n</transcript>${notesBlock(input.notes)}`,
    schema: actionOutput,
    effort: "low",
    timeoutMs: 50_000,
  });

  const startByIdx = new Map(input.segments.map((s) => [s.idx, s.startMs]));
  const wordsByIdx = new Map(input.segments.map((s) => [s.idx, s.text.split(/\s+/).filter(Boolean).length]));
  const byLower = new Map(input.participants.map((p) => [p.toLowerCase(), p]));
  let dropped = 0;

  const items = data.items.flatMap((item) => {
    // Same grounding rule as summaries: real indices only, and a substantive line beats "okay".
    const real = item.source_segments.filter((i) => startByIdx.has(i));
    const best = real.find((i) => (wordsByIdx.get(i) ?? 0) > 3) ?? real[0];
    const sourceMs = best === undefined ? undefined : startByIdx.get(best);
    if (sourceMs === undefined || !item.task.trim()) {
      dropped++;
      return [];
    }
    return [{
      text: item.task.trim(),
      assigneeName: item.assignee ? (byLower.get(item.assignee.toLowerCase()) ?? null) : null,
      dueDate: item.due_date && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) ? item.due_date : null,
      sourceMs,
    }];
  });
  return { items, model, attempts, dropped };
}
