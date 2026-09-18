import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { AskChat } from "@/components/ask-chat";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/api";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Ask Meetscribe" };

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string; meeting?: string }> }) {
  const user = await requireUser();
  const { q, meeting: meetingId } = await searchParams;

  const recent = await db.select({ id: schema.meetings.id, title: schema.meetings.title }).from(schema.meetings).where(eq(schema.meetings.ownerId, user.id)).orderBy(desc(schema.meetings.startedAt)).limit(3);
  const scoped = meetingId && isUuid(meetingId)
    ? (await db.select({ id: schema.meetings.id, title: schema.meetings.title }).from(schema.meetings).where(and(eq(schema.meetings.id, meetingId), eq(schema.meetings.ownerId, user.id))).limit(1))[0] ?? null
    : null;

  const suggestions = scoped
    ? ["What were the main points?", "What did each person commit to?", "Were any numbers, prices or dates mentioned?"]
    : recent.length > 1
      ? ["What changed between my last two meetings?", `What was decided in "${recent[0].title}"?`, "Who owns what right now?"]
      : recent.length === 1
        ? [`What were the main points of "${recent[0].title}"?`, "What did each person commit to?", "Were any numbers, prices or dates mentioned?"]
        : ["Add a meeting first, then ask about it here."];

  return (
    <>
      <PageHeader title="Ask Meetscribe" />
      {/* key: a different scope or question starts a fresh conversation */}
      <AskChat key={`${scoped?.id ?? "all"}:${q ?? ""}`} suggestions={suggestions} scopeMeeting={scoped} initialQuestion={q?.slice(0, 500)} />
    </>
  );
}
