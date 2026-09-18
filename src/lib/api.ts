import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** Resolves the signed-in user's own meeting, or the error response to return instead. */
export async function ownedMeeting(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Not signed in" }, { status: 401 }) } as const;
  if (!isUuid(id)) return { error: Response.json({ error: "Meeting not found" }, { status: 404 }) } as const;
  const [meeting] = await db.select().from(schema.meetings).where(and(eq(schema.meetings.id, id), eq(schema.meetings.ownerId, user.id))).limit(1);
  if (!meeting) return { error: Response.json({ error: "Meeting not found" }, { status: 404 }) } as const;
  return { user, meeting } as const;
}
