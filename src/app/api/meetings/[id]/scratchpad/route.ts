import { after } from "next/server";
import { z } from "zod";
import { ownedMeeting } from "@/lib/api";
import { indexScratchpad, saveScratchpad } from "@/lib/ingest";

const body = z.object({ content: z.string().max(50_000, "Notes are limited to 50,000 characters.") });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const result = await saveScratchpad(found.meeting.id, parsed.data.content);
  // Re-index for Ask after responding, so typing never waits on an embedding call.
  if (result.changed) after(() => indexScratchpad(found.meeting.id, parsed.data.content).catch((e) => console.error("indexScratchpad", e)));
  return Response.json(result);
}
