import { z } from "zod";
import type { SummaryContent, TemplateSection } from "@/db/schema";
import { generateJSON, type Attempt, type Order } from "@/lib/llm";

// Summary and action item generation.
//
// Grounding rule: the model never writes a timestamp. It cites transcript lines by their [index], and the
// server maps each index to that segment's real start offset. An index that does not exist is discarded,
// and a bullet left with no source (and not from the owner's notes) is dropped. A citation in the stored
// summary therefore always points at a real transcript segment.

export type SegmentInput = { idx: number; speaker: string; startMs: number; text: string };

// No timestamps in the prompt: the model cites by [index] and never needs them, and on a 244-line
// transcript they cost about 1,200 tokens, which matters under Groq's 8,000 tokens per minute.
function renderTranscript(segments: SegmentInput[]): string {
  return segments.map((s) => `[${s.idx}] ${s.speaker}: ${s.text}`).join("\n");
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

// ---------------------------------------------------------------- prompt rules

const INTRO = "The transcript is given one line per turn as: [index] Speaker: text";

function summaryRules(sections: TemplateSection[], hasNotes: boolean): string {
  return `Summary rules:
- Use only what is in the transcript${hasNotes ? " and the owner's notes" : ""}. Never add outside knowledge, guesses or advice.
- Every bullet must list in source_segments the [index] numbers of the lines it is based on. Use 1 to 4 indices, the most specific ones. Only use indices that appear in the transcript.
- Attribute statements to the person who made them, by name, when it matters who said it. People often introduce themselves by name: use those names.
- Keep numbers, dates, names and product terms exactly as spoken. Speech contains slips: if a figure is garbled or ambiguous ("twelve point twelve fifty"), quote it as spoken and say it is unclear. Never tidy it into a precise number nobody said, and never add arithmetic of your own.
- Dates: when a speaker gives only a day ("by the twenty second", "Monday the twenty first"), write it the same way ("the 22nd"). Do not add a month the speaker did not say.
- When a speaker corrects themselves ("over sixty nine, anything over fifty actually"), the correction is the fact. Report only the corrected version.
- Do not soften or sharpen what was said: "forty would be approved without a fight" is not "would only approve forty".
- Attribute a statement to the person who said it, not to the person who asked the question.
- Do not describe where information came from (a slide, a document, an email) unless the speaker says so.
- State each point once, in the section where it fits best. Do not repeat a point in a second section. Things the group agreed on belong under the decisions section when the template has one, not only under key points.
- One idea per bullet, one or two sentences, plain language, no filler such as "the team discussed".
- If a section has nothing real to report, return it with an empty bullets list. Do not pad.
- Transcripts from speech recognition contain errors and filler. Read through them; do not quote the noise.
${hasNotes ? NOTES_RULES : "- There are no owner notes. Set from_notes to false on every bullet."}

Produce exactly these sections, in this order, using these keys:
${sections.map((s) => `- key "${s.key}" (${s.title}): ${s.instruction}`).join("\n")}`;
}

function actionRules(participants: string[], meetingDate: Date, hasNotes: boolean): string {
  return `An action item is a piece of work someone is expected to do after the meeting. That includes:
- something a person says they will do ("I'll send the deck"),
- something a person is asked or assigned to do, including by a manager or chair handing out tasks. A brief or silent acceptance still counts; the assignment is what matters.
Not action items: things already done, general wishes, opinions, and topics that were only discussed.

Action item rules:
- task starts with a verb and is readable without the transcript: say what, not "put it in writing" or "mention the decision" (in writing: what? which decision?).
- ${participants.length
    ? `assignee must be exactly one of these names, or null: ${participants.map((p) => JSON.stringify(p)).join(", ")}. When someone says "I'll do it", the assignee is that speaker.`
    : `assignee is the person's name exactly as it is spoken in the transcript ("Jordan will book the movers" gives "Jordan"), or null when no name is given. This transcript has no speaker labels, so "I will" has no name: use null.`}
- A bare day of the month ("by the twenty second") means the next such date on or after the meeting date, not a later month.
- due_date only when a deadline was actually stated. The meeting took place on ${meetingDate.toISOString().slice(0, 10)} (${meetingDate.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" })}); resolve "Friday" or "next week" against that date. Otherwise null.
- source_segments are the [index] numbers of the 1 to 3 lines that say what is to be done and by whom, most informative first. This is only about which lines to cite: point at the line where the task is described, because a reply like "okay" tells a reader nothing. It does not change whether something is an action item. Only use indices that appear in the transcript.
- Merge duplicates. Order by when they came up. If there are none, return an empty list.${hasNotes ? "\n- The owner's notes in <owner_notes> correct the transcript. If they change an owner, a date or a task, use the corrected version." : ""}`;
}

// --------------------------------------------------------------------- schemas

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

const actionItemOutput = z.object({
  task: z.string(),
  assignee: z.string().nullable(),
  due_date: z.string().nullable().describe("YYYY-MM-DD or null"),
  source_segments: z.array(z.number().int()),
});

const actionOutput = z.object({ items: z.array(actionItemOutput) });
// Action items come FIRST in the schema. Models write JSON in order, and as the last field of a long
// summary they were an afterthought: three different models returned none for a meeting that has three.
const notesOutput = z.object({ action_items: z.array(actionItemOutput), ...summaryOutput.shape });

// ------------------------------------------------------------------- grounding

export type SummaryStats = { bullets: number; droppedUngrounded: number; invalidCitations: number };
export type GeneratedActionItem = { text: string; assigneeName: string | null; dueDate: string | null; sourceMs: number };

const wordCounts = (segments: SegmentInput[]) => new Map(segments.map((s) => [s.idx, s.text.split(/\s+/).filter(Boolean).length]));

/** Maps cited line indices to real segment offsets and drops whatever does not resolve. */
function groundSummary(data: z.infer<typeof summaryOutput>, segments: SegmentInput[], templateSections: TemplateSection[], hasNotes: boolean) {
  const startByIdx = new Map(segments.map((s) => [s.idx, s.startMs]));
  const wordsByIdx = wordCounts(segments);
  const stats: SummaryStats = { bullets: 0, droppedUngrounded: 0, invalidCitations: 0 };

  const sections = templateSections.map((template) => {
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

  return { content: { overview: data.overview.trim(), sections } as SummaryContent, stats };
}

function groundActionItems(raw: z.infer<typeof actionItemOutput>[], segments: SegmentInput[], participants: string[]) {
  const startByIdx = new Map(segments.map((s) => [s.idx, s.startMs]));
  const wordsByIdx = wordCounts(segments);
  const byLower = new Map(participants.map((p) => [p.toLowerCase(), p]));
  let dropped = 0;

  const items: GeneratedActionItem[] = raw.flatMap((item) => {
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
      // With known participants the name must be one of them. Audio has no speaker labels, so there a spoken name is kept as is.
      assigneeName: item.assignee ? (participants.length ? (byLower.get(item.assignee.toLowerCase()) ?? null) : item.assignee.trim().slice(0, 80) || null) : null,
      dueDate: item.due_date && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) ? item.due_date : null,
      sourceMs,
    }];
  });
  return { items, dropped };
}

// ------------------------------------------------------------------ generators

export type GeneratedSummary = { content: SummaryContent; title: string; model: string; attempts: Attempt[]; stats: SummaryStats };

/**
 * Summary and action items in ONE call. NOT used at ingest. It was built to fit Groq's 8,000 tokens per
 * minute, then measured on the real fixture: gemini-3.5-flash-lite returned no action items in two runs and
 * gpt-oss-120b returned 2, 0 and 2 of the 3, while the separate calls below found all 3 on every run.
 * Kept for scripts/compare-providers.ts, which is how that was measured, and because it halves the number
 * of requests if a provider with a tight daily cap and a strong model ever needs it.
 */
export async function generateMeetingNotes(input: {
  segments: SegmentInput[];
  sections: TemplateSection[];
  templateName: string;
  participants: string[];
  meetingDate: Date;
  notes?: string | null;
  order?: Order;
}): Promise<GeneratedSummary & { actionItems: GeneratedActionItem[]; droppedActionItems: number }> {
  const hasNotes = Boolean(input.notes?.trim());
  const { data, model, attempts } = await generateJSON({
    system: `You turn a meeting transcript into a summary and a list of action items, for people who were not in the meeting and need to act on it.

${INTRO}

Work in two passes. First read the whole transcript looking only for work that was handed out or promised, and fill action_items. Meetings usually end with the chair assigning tasks: check the last part of the transcript carefully. Then write the summary.

${actionRules(input.participants, input.meetingDate, hasNotes)}

${summaryRules(input.sections, hasNotes)}`,
    prompt: `Summary style: ${input.templateName}\n\n<transcript>\n${renderTranscript(input.segments)}\n</transcript>${notesBlock(input.notes)}`,
    schema: notesOutput,
    effort: "low",
    order: input.order,
    timeoutMs: 50_000,
  });
  const actions = groundActionItems(data.action_items, input.segments, input.participants);
  return { ...groundSummary(data, input.segments, input.sections, hasNotes), title: data.meeting_title.trim(), model, attempts, actionItems: actions.items, droppedActionItems: actions.dropped };
}

/** Summary only: switching template or regenerating after the notes changed (step 3). */
export async function generateSummary(input: { segments: SegmentInput[]; sections: TemplateSection[]; templateName: string; notes?: string | null; order?: Order }): Promise<GeneratedSummary> {
  const hasNotes = Boolean(input.notes?.trim());
  const { data, model, attempts } = await generateJSON({
    system: `You write meeting summaries for people who were not in the meeting and need to act on it.\n\n${INTRO}\n\n${summaryRules(input.sections, hasNotes)}`,
    prompt: `Summary style: ${input.templateName}\n\n<transcript>\n${renderTranscript(input.segments)}\n</transcript>${notesBlock(input.notes)}`,
    schema: summaryOutput,
    effort: "low",
    order: input.order,
    timeoutMs: 50_000,
  });
  return { ...groundSummary(data, input.segments, input.sections, hasNotes), title: data.meeting_title.trim(), model, attempts };
}

/** Action items only. */
export async function generateActionItems(input: { segments: SegmentInput[]; participants: string[]; meetingDate: Date; notes?: string | null; order?: Order }) {
  const hasNotes = Boolean(input.notes?.trim());
  const { data, model, attempts } = await generateJSON({
    system: `You extract action items from a meeting transcript.\n\n${INTRO}\n\n${actionRules(input.participants, input.meetingDate, hasNotes)}`,
    prompt: `<transcript>\n${renderTranscript(input.segments)}\n</transcript>${notesBlock(input.notes)}`,
    schema: actionOutput,
    effort: "low",
    order: input.order,
    timeoutMs: 50_000,
  });
  return { ...groundActionItems(data.items, input.segments, input.participants), model, attempts };
}
