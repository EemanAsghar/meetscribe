import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ownedMeeting } from "@/lib/api";
import { transcribeAndProcess } from "@/lib/ingest";
import { isOurBlobUrl } from "@/lib/transcribe";

export const maxDuration = 300;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }), // a scheduled meeting begins: scheduled -> recording
  z.object({ action: z.literal("finish"), audioUrl: z.string().refine(isOurBlobUrl, "Audio must be uploaded through Meetscribe."), durationMs: z.number().int().min(0).max(6 * 3600_000) }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(200).optional() }),
]);

/** The lifecycle of a captured meeting: scheduled -> recording -> processing -> ready. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { meeting } = found;
  const input = parsed.data;

  if (input.action === "start") {
    if (meeting.status !== "scheduled") return Response.json({ error: "This meeting has already started." }, { status: 409 });
    await db.update(schema.meetings).set({ status: "recording", startedAt: new Date() }).where(eq(schema.meetings.id, meeting.id));
    return Response.json({ id: meeting.id, status: "recording" });
  }
  if (meeting.status !== "recording") return Response.json({ error: "This meeting is not being recorded." }, { status: 409 });

  if (input.action === "cancel") {
    // Nothing is deleted: the row stays, marked as not captured, so a cancelled recording is still accounted for.
    await db.update(schema.meetings).set({ status: "failed", error: input.reason ?? "The recording was stopped before anything was saved." }).where(eq(schema.meetings.id, meeting.id));
    return Response.json({ id: meeting.id, status: "failed" });
  }

  await db.update(schema.meetings).set({ status: "processing", audioUrl: input.audioUrl, durationMs: input.durationMs }).where(eq(schema.meetings.id, meeting.id));
  after(() => transcribeAndProcess(meeting.id, input.audioUrl));
  return Response.json({ id: meeting.id, status: "processing" });
}
