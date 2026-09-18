import { after } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createMeetingFromTranscript, createMeetingShell, processMeeting, transcribeAndProcess } from "@/lib/ingest";
import { isOurBlobUrl } from "@/lib/transcribe";
import { TranscriptError } from "@/lib/transcript/parse";

// Generation runs in after(), inside this invocation, so the budget covers Whisper plus the model calls.
export const maxDuration = 300;

const title = z.string().trim().max(160).optional();
const body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transcript"),
    transcript: z.string().min(1, "Paste a transcript first.").max(600_000, "That transcript is too long (600,000 characters max)."),
    title,
    startedAt: z.iso.datetime({ offset: true }).optional(),
    source: z.enum(["paste", "upload"]).optional(),
  }),
  // An uploaded audio file, already in our Blob store.
  z.object({ kind: z.literal("audio"), audioUrl: z.string().refine(isOurBlobUrl, "Audio must be uploaded through Meetscribe."), title }),
  // "Start instant meeting": the row exists from the first second, so the capture is visible everywhere.
  z.object({ kind: z.literal("record"), title }),
  // Stand-in for a calendar integration (SPEC.md section 1, stubbed): a meeting due to start soon.
  z.object({ kind: z.literal("schedule"), title: z.string().trim().min(1).max(160), inMinutes: z.number().min(0).max(24 * 60) }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  // Requests from before `kind` existed are pasted transcripts.
  const parsed = body.safeParse(raw && typeof raw === "object" && !("kind" in raw) ? { kind: "transcript", ...raw } : raw);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const input = parsed.data;

  try {
    if (input.kind === "transcript") {
      const { meeting, format, segments, chunks } = await createMeetingFromTranscript({
        ownerId: user.id,
        transcript: input.transcript,
        title: input.title,
        startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
        source: input.source,
      });
      // Respond now so the browser can open the meeting and watch it fill in; generate afterwards.
      after(() => processMeeting(meeting.id).catch(() => {}));
      return Response.json({ id: meeting.id, format, segments, chunks }, { status: 201 });
    }
    if (input.kind === "audio") {
      const meeting = await createMeetingShell({ ownerId: user.id, title: input.title, source: "upload", status: "processing", audioUrl: input.audioUrl });
      after(() => transcribeAndProcess(meeting.id, input.audioUrl));
      return Response.json({ id: meeting.id }, { status: 201 });
    }
    if (input.kind === "record") {
      const meeting = await createMeetingShell({ ownerId: user.id, title: input.title, source: "instant", status: "recording" });
      return Response.json({ id: meeting.id }, { status: 201 });
    }
    const meeting = await createMeetingShell({ ownerId: user.id, title: input.title, source: "scheduled", status: "scheduled", startedAt: new Date(Date.now() + input.inMinutes * 60_000) });
    return Response.json({ id: meeting.id, startsAt: meeting.startedAt }, { status: 201 });
  } catch (error) {
    if (error instanceof TranscriptError) return Response.json({ error: error.message }, { status: 422 });
    console.error("POST /api/meetings", error);
    return Response.json({ error: "Could not save the meeting." }, { status: 500 });
  }
}
