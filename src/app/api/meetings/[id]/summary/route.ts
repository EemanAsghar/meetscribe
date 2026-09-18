import { z } from "zod";
import { isUuid, ownedMeeting } from "@/lib/api";
import { regenerateSummary } from "@/lib/ingest";
import { LLMError } from "@/lib/llm";

export const maxDuration = 120;

const body = z.object({ templateId: z.string().refine(isUuid, "Unknown template"), force: z.boolean().optional() });

/** Switch template, regenerate after the notes changed, or retry a failed generation (force). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  if (found.meeting.status === "processing") return Response.json({ error: "This meeting is still being processed." }, { status: 409 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  try {
    return Response.json(await regenerateSummary({ meetingId: found.meeting.id, ...parsed.data }));
  } catch (error) {
    console.error("POST summary", error);
    if (error instanceof LLMError) {
      // The previous summary is untouched: a failed regeneration never leaves the meeting worse off.
      return Response.json({ error: "The AI models are busy or out of free quota right now. Your current summary is unchanged. Try again in a minute." }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "Template not found" ? message : "Could not regenerate the summary." }, { status: message === "Template not found" ? 404 : 500 });
  }
}
