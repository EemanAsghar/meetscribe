import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateActionItems, generateSummary } from "@/lib/generate";
import { embed } from "@/lib/llm";
import { chunkSegments } from "@/lib/transcript/chunk";
import { UNKNOWN_SPEAKER, parseTranscript } from "@/lib/transcript/parse";

export const DEFAULT_TEMPLATE_SLUG = "general";
const PLACEHOLDER_TITLE = "Untitled meeting";

/** Parses and stores a transcript. Fast (no model calls): the caller can redirect as soon as this returns. */
export async function createMeetingFromTranscript(input: {
  ownerId: string;
  transcript: string;
  title?: string;
  startedAt?: Date;
  source?: "paste" | "upload" | "instant" | "scheduled";
}) {
  const parsed = parseTranscript(input.transcript); // throws TranscriptError on unusable input

  const [template] = await db.select().from(schema.templates).where(eq(schema.templates.slug, DEFAULT_TEMPLATE_SLUG)).limit(1);
  const [meeting] = await db
    .insert(schema.meetings)
    .values({
      ownerId: input.ownerId,
      title: input.title?.trim() || PLACEHOLDER_TITLE,
      startedAt: input.startedAt ?? new Date(),
      durationMs: parsed.durationMs,
      source: input.source ?? "paste",
      status: "processing",
      timestampsEstimated: parsed.timestampsEstimated,
      activeTemplateId: template?.id,
      shareSlug: randomBytes(9).toString("base64url"),
    })
    .returning();

  try {
    const names = parsed.speakers.filter((s) => s !== UNKNOWN_SPEAKER);
    const known = names.length ? await db.select().from(schema.users).where(inArray(schema.users.name, names)) : [];
    if (names.length) {
      await db.insert(schema.participants).values(names.map((name) => ({ meetingId: meeting.id, name, userId: known.find((u) => u.name === name)?.id })));
    }
    for (let i = 0; i < parsed.segments.length; i += 500) {
      await db.insert(schema.transcriptSegments).values(parsed.segments.slice(i, i + 500).map((s) => ({ meetingId: meeting.id, ...s })));
    }
    const chunks = chunkSegments(parsed.segments);
    for (let i = 0; i < chunks.length; i += 200) {
      await db.insert(schema.transcriptChunks).values(
        chunks.slice(i, i + 200).map((c) => ({
          meetingId: meeting.id,
          kind: "transcript" as const,
          segFrom: c.segFrom,
          segTo: c.segTo,
          startMs: c.startMs,
          endMs: c.endMs,
          speakerLabel: c.speakerLabel,
          text: c.text,
        })),
      );
    }
    await db.insert(schema.scratchpads).values({ meetingId: meeting.id });
    return { meeting, format: parsed.format, segments: parsed.segments.length, chunks: chunks.length };
  } catch (error) {
    // The HTTP driver has no multi-statement transaction, so undo by hand. Children cascade.
    await db.delete(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    throw error;
  }
}

/** The slow part: embeddings, summary, action items. Runs after the response has been sent. */
export async function processMeeting(meetingId: string) {
  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, fn: () => Promise<T>) => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[label] = Date.now() - t;
    }
  };

  try {
    const [meeting] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId)).limit(1);
    if (!meeting) return;
    const [segments, participants, [template], [pad]] = await Promise.all([
      db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, meetingId)).orderBy(asc(schema.transcriptSegments.idx)),
      db.select().from(schema.participants).where(eq(schema.participants.meetingId, meetingId)),
      db.select().from(schema.templates).where(eq(schema.templates.id, meeting.activeTemplateId!)).limit(1),
      db.select().from(schema.scratchpads).where(eq(schema.scratchpads.meetingId, meetingId)).limit(1),
    ]);

    const [summary, actions] = await Promise.all([
      timed("summary", () => generateSummary({ segments, sections: template.sections, templateName: template.name, notes: pad?.content })),
      timed("actionItems", () =>
        generateActionItems({ segments, participants: participants.map((p) => p.name), meetingDate: meeting.startedAt, notes: pad?.content }),
      ),
      // Embeddings are best effort: without them Ask falls back to full-text search (SPEC.md section 5).
      timed("embeddings", () => embedChunks(meetingId)).catch((error) => console.error("embedding failed", meetingId, error)),
    ]);

    await db.update(schema.summaries).set({ isCurrent: false }).where(and(eq(schema.summaries.meetingId, meetingId), eq(schema.summaries.templateId, template.id)));
    await db.insert(schema.summaries).values({
      meetingId,
      templateId: template.id,
      content: summary.content,
      notesVersionUsed: pad?.version ?? 0,
      model: summary.model,
    });

    // Regeneration replaces open AI items only. Manual items and completed ones are never touched.
    await db.delete(schema.actionItems).where(and(eq(schema.actionItems.meetingId, meetingId), eq(schema.actionItems.origin, "ai"), eq(schema.actionItems.done, false)));
    if (actions.items.length) {
      await db.insert(schema.actionItems).values(
        actions.items.map((item, i) => ({
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

    await db
      .update(schema.meetings)
      .set({ status: "ready", error: null, ...(meeting.title === PLACEHOLDER_TITLE && summary.title ? { title: summary.title } : {}) })
      .where(eq(schema.meetings.id, meetingId));

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

async function embedChunks(meetingId: string) {
  const chunks = await db.select({ id: schema.transcriptChunks.id, text: schema.transcriptChunks.text }).from(schema.transcriptChunks).where(eq(schema.transcriptChunks.meetingId, meetingId));
  const vectors = await embed(chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT");
  for (let i = 0; i < chunks.length; i += 20) {
    await Promise.all(chunks.slice(i, i + 20).map((c, j) => db.update(schema.transcriptChunks).set({ embedding: vectors[i + j] }).where(eq(schema.transcriptChunks.id, c.id))));
  }
  return chunks.length;
}
