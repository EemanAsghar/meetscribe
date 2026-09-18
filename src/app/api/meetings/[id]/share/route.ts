import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ownedMeeting } from "@/lib/api";

const body = z.object({ enabled: z.boolean().optional(), reset: z.boolean().optional() });

/**
 * Turn the public link on or off, or replace it. Replacing the slug is the only way to take back a link that
 * has already been passed around: the old URL stops working at once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.enabled === undefined && !parsed.data.reset)) return Response.json({ error: "Invalid request" }, { status: 400 });

  const [meeting] = await db
    .update(schema.meetings)
    .set({
      ...(parsed.data.enabled !== undefined ? { shareEnabled: parsed.data.enabled } : {}),
      ...(parsed.data.reset ? { shareSlug: randomBytes(9).toString("base64url") } : {}),
    })
    .where(eq(schema.meetings.id, found.meeting.id))
    .returning({ shareEnabled: schema.meetings.shareEnabled, shareSlug: schema.meetings.shareSlug });
  return Response.json(meeting);
}
