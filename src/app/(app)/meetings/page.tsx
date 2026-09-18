import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Plus, Upload, Video } from "lucide-react";
import { MeetingsList, type MeetingRow } from "@/components/meetings-list";
import { PageHeader } from "@/components/page-header";
import { StartRecordingButton } from "@/components/recording";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Meetings" };

export default async function MeetingsPage() {
  const user = await requireUser();
  const meetings = await db.select().from(schema.meetings).where(eq(schema.meetings.ownerId, user.id)).orderBy(desc(schema.meetings.startedAt));
  const ids = meetings.map((m) => m.id);

  // Three flat queries merged here, instead of one join that multiplies rows per participant and per item.
  const [people, summaries, items] = ids.length
    ? await Promise.all([
        db.select().from(schema.participants).where(inArray(schema.participants.meetingId, ids)),
        db.select({ meetingId: schema.summaries.meetingId, templateId: schema.summaries.templateId, content: schema.summaries.content }).from(schema.summaries).where(and(inArray(schema.summaries.meetingId, ids), eq(schema.summaries.isCurrent, true))),
        db.select({ meetingId: schema.actionItems.meetingId, done: schema.actionItems.done }).from(schema.actionItems).where(inArray(schema.actionItems.meetingId, ids)),
      ])
    : [[], [], []];

  const rows: MeetingRow[] = meetings.map((m) => {
    const mine = items.filter((i) => i.meetingId === m.id);
    return {
      id: m.id,
      title: m.title,
      startedAt: m.startedAt.toISOString(),
      durationMs: m.durationMs,
      estimated: m.timestampsEstimated,
      source: m.source,
      status: m.status,
      shared: m.shareEnabled,
      people: people.filter((p) => p.meetingId === m.id).map((p) => p.name),
      // The overview of the summary the owner is looking at: the active template's.
      overview: summaries.find((s) => s.meetingId === m.id && s.templateId === m.activeTemplateId)?.content.overview ?? null,
      openItems: mine.filter((i) => !i.done).length,
      totalItems: mine.length,
    };
  });

  return (
    <>
      <PageHeader
        title="Meetings"
        meta={rows.length > 0 && <span className="tabular">{rows.length}</span>}
        actions={
          <>
            <Button asChild size="sm"><Link href="/meetings/new"><Upload /> Upload or paste</Link></Button>
            <StartRecordingButton />
          </>
        }
      />
      <main className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={Video}
            title="No meetings yet"
            action={
              <>
                <StartRecordingButton size="md" />
                <Button asChild><Link href="/meetings/new"><Plus /> Upload or paste</Link></Button>
              </>
            }
          >
            Record a conversation in your browser, upload audio, or paste a transcript. Meetscribe turns it into a summary, action items and something you can ask questions of.
          </EmptyState>
        ) : (
          <MeetingsList meetings={rows} />
        )}
      </main>
    </>
  );
}
