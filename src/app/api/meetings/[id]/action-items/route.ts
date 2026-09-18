import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isUuid, ownedMeeting } from "@/lib/api";

const text = z.string().trim().min(1, "Write the task first.").max(500, "Keep a task under 500 characters.");
const assignee = z.string().trim().max(80).nullable();
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const createBody = z.object({ text, assigneeName: assignee.optional(), dueDate: dueDate.optional() });
const patchBody = z.object({ id: z.string().refine(isUuid), text: text.optional(), assigneeName: assignee.optional(), dueDate: dueDate.optional(), done: z.boolean().optional() });
const deleteBody = z.object({ id: z.string().refine(isUuid) });

type Params = { params: Promise<{ id: string }> };
const bad = (parsed: { error: z.ZodError }) => Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

/** Links a typed name to a known person when there is one, so assignment is more than a label. */
async function userIdFor(meetingId: string, name: string | null | undefined) {
  if (!name) return null;
  const [participant] = await db.select().from(schema.participants).where(and(eq(schema.participants.meetingId, meetingId), eq(schema.participants.name, name))).limit(1);
  if (participant?.userId) return participant.userId;
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.name, name)).limit(1);
  return user?.id ?? null;
}

/** Add an item by hand. origin = 'manual', so regenerating never touches it (SPEC.md section 4). */
export async function POST(request: Request, { params }: Params) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const parsed = createBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed);

  const [{ last }] = await db.select({ last: max(schema.actionItems.sortOrder) }).from(schema.actionItems).where(eq(schema.actionItems.meetingId, found.meeting.id));
  const [item] = await db
    .insert(schema.actionItems)
    .values({
      meetingId: found.meeting.id,
      text: parsed.data.text,
      assigneeName: parsed.data.assigneeName ?? null,
      assigneeUserId: await userIdFor(found.meeting.id, parsed.data.assigneeName),
      dueDate: parsed.data.dueDate ?? null,
      origin: "manual",
      sortOrder: (last ?? -1) + 1,
    })
    .returning();
  return Response.json(item, { status: 201 });
}

export async function PATCH(request: Request, { params }: Params) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const parsed = patchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed);
  const { id, ...changes } = parsed.data;

  const set: Partial<typeof schema.actionItems.$inferInsert> = {};
  if (changes.text !== undefined) set.text = changes.text;
  if (changes.done !== undefined) set.done = changes.done;
  if (changes.dueDate !== undefined) set.dueDate = changes.dueDate;
  if (changes.assigneeName !== undefined) {
    set.assigneeName = changes.assigneeName;
    set.assigneeUserId = await userIdFor(found.meeting.id, changes.assigneeName);
  }
  if (Object.keys(set).length === 0) return Response.json({ error: "Nothing to change" }, { status: 400 });

  // The meeting id in the WHERE clause is what stops one user editing another meeting's item by guessing ids.
  const [item] = await db.update(schema.actionItems).set(set).where(and(eq(schema.actionItems.id, id), eq(schema.actionItems.meetingId, found.meeting.id))).returning();
  return item ? Response.json(item) : Response.json({ error: "Action item not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const parsed = deleteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed);
  const [item] = await db.delete(schema.actionItems).where(and(eq(schema.actionItems.id, parsed.data.id), eq(schema.actionItems.meetingId, found.meeting.id))).returning({ id: schema.actionItems.id });
  return item ? Response.json(item) : Response.json({ error: "Action item not found" }, { status: 404 });
}
