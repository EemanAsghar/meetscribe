import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SummaryContent } from "@/db/schema";
import { generateActionItems, generateSummary, type GeneratedActionItem, type GeneratedSummary } from "@/lib/generate";
import { embed } from "@/lib/llm";
import { chunkSegments } from "@/lib/transcript/chunk";
import { transcribeAudio } from "@/lib/transcribe";
import { UNKNOWN_SPEAKER, parseTranscript, type ParsedTranscript } from "@/lib/transcript/parse";

export const DEFAULT_TEMPLATE_SLUG = "general";
const PLACEHOLDER_TITLE = "Untitled meeting";

type Source = "paste" | "upload" | "instant" | "scheduled";

async function defaultTemplateId() {
  const [template] = await db.select().from(schema.templates).where(eq(schema.templates.slug, DEFAULT_TEMPLATE_SLUG)).limit(1);
  return template?.id;
}

/** A meeting with no transcript yet: scheduled, being recorded, or audio waiting for transcription. */
export async function createMeetingShell(input: { ownerId: string; title?: string; source: Source; status: "scheduled" | "recording" | "processing"; startedAt?: Date; audioUrl?: string; durationMs?: number }) {
  const [meeting] = await db
    .insert(schema.meetings)
    .values({
      ownerId: input.ownerId,
      title: input.title?.trim() || PLACEHOLDER_TITLE,
      startedAt: input.startedAt ?? new Date(),
      durationMs: input.durationMs ?? 0,
      source: input.source,
      status: input.status,
      audioUrl: input.audioUrl,
      activeTemplateId: await defaultTemplateId(),
      shareSlug: randomBytes(9).toString("base64url"),
    })
    .returning();
  await db.insert(schema.scratchpads).values({ meetingId: meeting.id }).onConflictDoNothing();
  return meeting;
}

/** Stores segments, participants and retrieval chunks for a meeting. Shared by pasted text and transcribed audio. */
export async function storeTranscript(meetingId: string, parsed: ParsedTranscript) {
  const names = parsed.speakers.filter((s) => s !== UNKNOWN_SPEAKER);
  const known = names.length ? await db.select().from(schema.users).where(inArray(schema.users.name, names)) : [];
  if (names.length) {
    await db.insert(schema.participants).values(names.map((name) => ({ meetingId, name, userId: known.find((u) => u.name === name)?.id }))).onConflictDoNothing();
  }
  for (let i = 0; i < parsed.segments.length; i += 500) {
    await db.insert(schema.transcriptSegments).values(parsed.segments.slice(i, i + 500).map((s) => ({ meetingId, ...s })));
  }
  const chunks = chunkSegments(parsed.segments);
  for (let i = 0; i < chunks.length; i += 200) {
    await db.insert(schema.transcriptChunks).values(
      chunks.slice(i, i + 200).map((c) => ({ meetingId, kind: "transcript" as const, segFrom: c.segFrom, segTo: c.segTo, startMs: c.startMs, endMs: c.endMs, speakerLabel: c.speakerLabel, text: c.text })),
    );
  }
  await db.update(schema.meetings).set({ durationMs: parsed.durationMs, timestampsEstimated: parsed.timestampsEstimated }).where(eq(schema.meetings.id, meetingId));
  return { segments: parsed.segments.length, chunks: chunks.length };
}

/** Parses and stores a pasted transcript. Fast (no model calls): the caller can redirect as soon as this returns. */
export async function createMeetingFromTranscript(input: { ownerId: string; transcript: string; title?: string; startedAt?: Date; source?: Source }) {
  const parsed = parseTranscript(input.transcript); // throws TranscriptError on unusable input
  const meeting = await createMeetingShell({ ownerId: input.ownerId, title: input.title, startedAt: input.startedAt, source: input.source ?? "paste", status: "processing" });
  try {
    const stored = await storeTranscript(meeting.id, parsed);
    return { meeting, format: parsed.format, ...stored };
  } catch (error) {
    // The HTTP driver has no multi-statement transaction, so undo by hand. Children cascade.
    await db.delete(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    throw error;
  }
}

/** Audio path: Whisper, then the same pipeline as a pasted transcript. Runs after the response has been sent. */
export async function transcribeAndProcess(meetingId: string, audioUrl: string) {
  try {
    const started = Date.now();
    const parsed = await transcribeAudio(audioUrl);
    const stored = await storeTranscript(meetingId, parsed);
    console.log("transcribed", JSON.stringify({ meetingId, ms: Date.now() - started, language: parsed.language, ...stored, durationMs: parsed.durationMs }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("transcription failed", meetingId, message);
    await db.update(schema.meetings).set({ status: "failed", error: `Transcription: ${message}`.slice(0, 500) }).where(eq(schema.meetings.id, meetingId));
    return;
  }
  await processMeeting(meetingId).catch(() => {});
}

type Timings = Record<string, number>;
const timer = (timings: Timings) => async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - t;
  }
};

async function loadContext(meetingId: string) {
  const [meeting] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId)).limit(1);
  if (!meeting) return null;
  const [segments, participants, [pad]] = await Promise.all([
    db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, meetingId)).orderBy(asc(schema.transcriptSegments.idx)),
    db.select().from(schema.participants).where(eq(schema.participants.meetingId, meetingId)),
    db.select().from(schema.scratchpads).where(eq(schema.scratchpads.meetingId, meetingId)).limit(1),
  ]);
  return { meeting, segments, participants, notes: pad?.content ?? "", notesVersion: pad?.version ?? 0 };
}

/** The new summary becomes current for its (meeting, template). Earlier versions are kept, not deleted. */
async function saveSummary(meetingId: string, templateId: string, summary: GeneratedSummary, notesVersion: number) {
  await db.update(schema.summaries).set({ isCurrent: false }).where(and(eq(schema.summaries.meetingId, meetingId), eq(schema.summaries.templateId, templateId), eq(schema.summaries.isCurrent, true)));
  await db.insert(schema.summaries).values({ meetingId, templateId, content: summary.content, notesVersionUsed: notesVersion, model: summary.model });
}

/** Regeneration replaces open AI items only. Manual items and completed ones are never touched (SPEC.md section 4). */
async function saveActionItems(meetingId: string, participants: { name: string; userId: string | null }[], items: GeneratedActionItem[]) {
  await db.delete(schema.actionItems).where(and(eq(schema.actionItems.meetingId, meetingId), eq(schema.actionItems.origin, "ai"), eq(schema.actionItems.done, false)));
  if (items.length === 0) return;
  await db.insert(schema.actionItems).values(
    items.map((item, i) => ({
      meetingId,
      text: item.text,
      assigneeName: item.assigneeName,
      assigneeUserId: participants.find((p) => p.name === item.assigneeName)?.userId,
      dueDate: item.dueDate,
      sourceMs: item.sourceMs,
      origin: "ai" as const,
      sortOrder: i,
    })),
  );
}

/** The slow part of ingest: embeddings, summary, action items. Runs after the response has been sent. */
export async function processMeeting(meetingId: string) {
  const timings: Timings = {};
  const timed = timer(timings);
  try {
    const ctx = await loadContext(meetingId);
    if (!ctx) return;
    const { meeting, segments, participants, notes, notesVersion } = ctx;
    const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, meeting.activeTemplateId!)).limit(1);

    // Two calls, in parallel. A single merged call was tried and lost action items (see generate.ts).
    const [summary, actions] = await Promise.all([
      timed("summary", () => generateSummary({ segments, sections: template.sections, templateName: template.name, notes })),
      timed("actionItems", () => generateActionItems({ segments, participants: participants.map((p) => p.name), meetingDate: meeting.startedAt, notes })),
      // Embeddings are best effort: without them Ask falls back to full-text search (SPEC.md section 5).
      // They carry the meeting title, so an untitled meeting is embedded below, once the model has named it.
      meeting.title === PLACEHOLDER_TITLE ? null : timed("embeddings", () => embedChunks(meetingId)).catch((error) => console.error("embedding failed", meetingId, error)),
    ]);

    await saveSummary(meetingId, template.id, summary, notesVersion);
    await saveActionItems(meetingId, participants, actions.items);
    await db
      .update(schema.meetings)
      .set({ status: "ready", error: null, ...(meeting.title === PLACEHOLDER_TITLE && summary.title ? { title: summary.title } : {}) })
      .where(eq(schema.meetings.id, meetingId));
    if (meeting.title === PLACEHOLDER_TITLE) await timed("embeddings", () => embedChunks(meetingId)).catch((error) => console.error("embedding failed", meetingId, error));

    const report = { meetingId, timings, summary: { model: summary.model, attempts: summary.attempts, ...summary.stats }, actions: { model: actions.model, attempts: actions.attempts, items: actions.items.length, dropped: actions.dropped } };
    console.log("processMeeting", JSON.stringify(report));
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("processMeeting failed", meetingId, message);
    await db.update(schema.meetings).set({ status: "failed", error: message.slice(0, 500) }).where(eq(schema.meetings.id, meetingId));
    throw error;
  }
}

export type RegenerateResult = { cached: boolean; model: string | null; fromNotesBullets: number; actionItemsRefreshed: boolean; ms: number };

/**
 * Switches template and/or regenerates. Model calls are scarce (20 a day per Gemini model), so:
 *  - a template whose current summary already used this version of the notes is served from the database;
 *  - action items are re-extracted only when the notes changed since they were last used, or on a forced retry.
 */
export async function regenerateSummary(input: { meetingId: string; templateId: string; force?: boolean }): Promise<RegenerateResult> {
  const started = Date.now();
  // Cheap lookups first: a cached switch must not pay for loading the whole transcript.
  const [[template], [pad], currentRows] = await Promise.all([
    db.select().from(schema.templates).where(eq(schema.templates.id, input.templateId)).limit(1),
    db.select({ version: schema.scratchpads.version }).from(schema.scratchpads).where(eq(schema.scratchpads.meetingId, input.meetingId)).limit(1),
    db.select().from(schema.summaries).where(and(eq(schema.summaries.meetingId, input.meetingId), eq(schema.summaries.isCurrent, true))),
  ]);
  if (!template) throw new Error("Template not found");
  const existing = currentRows.find((r) => r.templateId === template.id);

  if (existing && existing.notesVersionUsed === (pad?.version ?? 0) && !input.force) {
    await db.update(schema.meetings).set({ activeTemplateId: template.id }).where(eq(schema.meetings.id, input.meetingId));
    return { cached: true, model: existing.model, fromNotesBullets: countFromNotes(existing.content), actionItemsRefreshed: false, ms: Date.now() - started };
  }

  const ctx = await loadContext(input.meetingId);
  if (!ctx) throw new Error("Meeting not found");
  const { meeting, segments, participants, notes, notesVersion } = ctx;

  // Action items do not depend on the template. Refresh them only if no summary has seen this version of the notes yet.
  const notesAreNew = !currentRows.some((r) => r.notesVersionUsed === notesVersion);
  const refreshActions = Boolean(input.force) || (notesAreNew && notesVersion > 0);

  const [summary, actions] = await Promise.all([
    generateSummary({ segments, sections: template.sections, templateName: template.name, notes }),
    refreshActions ? generateActionItems({ segments, participants: participants.map((p) => p.name), meetingDate: meeting.startedAt, notes }) : null,
  ]);

  await saveSummary(meeting.id, template.id, summary, notesVersion);
  // An empty result must not wipe a good list. Measured: a fallback model returned no action items for a
  // meeting that has three, and replacing on that answer deleted all of them. Empty means "keep what is there".
  const actionItemsRefreshed = Boolean(actions && actions.items.length > 0);
  if (actions && actionItemsRefreshed) await saveActionItems(meeting.id, participants, actions.items);
  await db.update(schema.meetings).set({ activeTemplateId: template.id, status: "ready", error: null }).where(eq(schema.meetings.id, meeting.id));

  const result = { cached: false, model: summary.model, fromNotesBullets: countFromNotes(summary.content), actionItemsRefreshed, ms: Date.now() - started };
  console.log("regenerateSummary", JSON.stringify({ meetingId: meeting.id, template: template.slug, notesVersion, ...result, attempts: summary.attempts, ...summary.stats }));
  return result;
}

const countFromNotes = (content: SummaryContent) => content.sections.reduce((n, s) => n + s.bullets.filter((b) => b.from_notes).length, 0);

/** Saves the Scratchpad. The version only moves when the text really changed, because it is what marks summaries stale. */
export async function saveScratchpad(meetingId: string, content: string) {
  const [pad] = await db.select().from(schema.scratchpads).where(eq(schema.scratchpads.meetingId, meetingId)).limit(1);
  if (pad && pad.content === content) return { version: pad.version, changed: false };
  const version = (pad?.version ?? 0) + 1;
  await db
    .insert(schema.scratchpads)
    .values({ meetingId, content, version, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.scratchpads.meetingId, set: { content, version, updatedAt: new Date() } });
  return { version, changed: true };
}

/**
 * Notes are retrieval sources too (kind = 'note'), so Ask can cite them. Replaces this meeting's note chunks.
 * Embedding is best effort and on a separate quota from text generation.
 */
export async function indexScratchpad(meetingId: string, content: string) {
  await db.delete(schema.transcriptChunks).where(and(eq(schema.transcriptChunks.meetingId, meetingId), eq(schema.transcriptChunks.kind, "note")));
  const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return 0;
  // Paragraphs are packed up to the same ceiling as transcript chunks.
  const texts: string[] = [];
  for (const p of paragraphs) {
    const last = texts[texts.length - 1];
    if (last && (last + " " + p).split(/\s+/).length <= 250) texts[texts.length - 1] = `${last}\n\n${p}`;
    else texts.push(p);
  }
  const [meeting] = await db.select({ title: schema.meetings.title }).from(schema.meetings).where(eq(schema.meetings.id, meetingId)).limit(1);
  const vectors = await embed(texts.map((t) => embeddingText(meeting?.title ?? "", t)), "RETRIEVAL_DOCUMENT").catch(() => null);
  await db.insert(schema.transcriptChunks).values(texts.map((text, i) => ({ meetingId, kind: "note" as const, speakerLabel: "Scratchpad", text, embedding: vectors?.[i] })));
  return texts.length;
}

/**
 * What gets embedded is the chunk WITH its meeting title in front. People in a meeting about Harbor Logistics
 * do not keep saying "Harbor Logistics", so a chunk embedded alone does not know what it is about. Measured:
 * "What does Harbor Logistics need?" did not retrieve the passage listing their must-haves until this was added.
 */
export function embeddingText(meetingTitle: string, chunkText: string): string {
  return meetingTitle && meetingTitle !== PLACEHOLDER_TITLE ? `${meetingTitle}\n${chunkText}` : chunkText;
}

export async function embedChunks(meetingId: string) {
  const [meeting] = await db.select({ title: schema.meetings.title }).from(schema.meetings).where(eq(schema.meetings.id, meetingId)).limit(1);
  const chunks = await db.select({ id: schema.transcriptChunks.id, text: schema.transcriptChunks.text }).from(schema.transcriptChunks).where(eq(schema.transcriptChunks.meetingId, meetingId));
  const vectors = await embed(chunks.map((c) => embeddingText(meeting?.title ?? "", c.text)), "RETRIEVAL_DOCUMENT");
  for (let i = 0; i < chunks.length; i += 20) {
    await Promise.all(chunks.slice(i, i + 20).map((c, j) => db.update(schema.transcriptChunks).set({ embedding: vectors[i + j] }).where(eq(schema.transcriptChunks.id, c.id))));
  }
  return chunks.length;
}
