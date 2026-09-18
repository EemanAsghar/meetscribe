import { after } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createMeetingFromTranscript, processMeeting } from "@/lib/ingest";
import { TranscriptError } from "@/lib/transcript/parse";

// Generation runs in after(), inside this invocation, so the budget covers two model calls plus embeddings.
export const maxDuration = 120;

const body = z.object({
  transcript: z.string().min(1, "Paste a transcript first.").max(600_000, "That transcript is too long (600,000 characters max)."),
  title: z.string().trim().max(160).optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["paste", "upload"]).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  try {
    const { meeting, format, segments, chunks } = await createMeetingFromTranscript({
      ownerId: user.id,
      transcript: parsed.data.transcript,
      title: parsed.data.title,
      startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : undefined,
      source: parsed.data.source,
    });
    // Respond now so the browser can open the meeting and watch it fill in; generate afterwards.
    after(() => processMeeting(meeting.id).catch(() => {}));
    return Response.json({ id: meeting.id, format, segments, chunks }, { status: 201 });
  } catch (error) {
    if (error instanceof TranscriptError) return Response.json({ error: error.message }, { status: 422 });
    console.error("POST /api/meetings", error);
    return Response.json({ error: "Could not save the meeting." }, { status: 500 });
  }
}
