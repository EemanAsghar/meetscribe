import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Mic, Plus, Upload, Video } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDuration } from "@/lib/utils";

export const metadata: Metadata = { title: "Meetings" };

const dateFmt = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });

export default async function MeetingsPage() {
  const user = await requireUser();
  const meetings = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.ownerId, user.id))
    .orderBy(desc(schema.meetings.startedAt));

  return (
    <>
      <PageHeader
        title="Meetings"
        meta={meetings.length > 0 && <span className="tabular">{meetings.length}</span>}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/meetings/new">
              <Plus /> New meeting
            </Link>
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto">
        {meetings.length === 0 ? (
          <EmptyState
            icon={Video}
            title="No meetings yet"
            action={
              <>
                <Button asChild variant="primary">
                  <Link href="/meetings/new?mode=record">
                    <Mic /> Start instant meeting
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/meetings/new">
                    <Upload /> Upload or paste
                  </Link>
                </Button>
              </>
            }
          >
            Record a conversation in your browser, upload audio, or paste a transcript. Meetscribe turns it into a summary,
            action items and something you can ask questions of.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex h-11 items-center gap-3 px-5 transition-colors hover:bg-hover">
                  <span className="flex-1 truncate text-sm font-medium text-ink">{m.title}</span>
                  <span className="text-xs capitalize text-ink-4">{m.status}</span>
                  <span className="tabular w-16 text-right text-xs text-ink-3">{formatDuration(m.durationMs)}</span>
                  <span className="tabular w-24 text-right text-xs text-ink-3">{dateFmt.format(m.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
