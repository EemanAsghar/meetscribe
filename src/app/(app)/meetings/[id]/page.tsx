import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { CheckSquare, FileText, NotebookPen, ScrollText } from "lucide-react";
import { MeetingTabs, parseTab, type MeetingTab } from "@/components/meeting-tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDuration } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadMeeting(id: string, ownerId: string) {
  if (!UUID.test(id)) return null;
  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.id, id), eq(schema.meetings.ownerId, ownerId)))
    .limit(1);
  return meeting ?? null;
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; t?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await requireUser();
  const meeting = await loadMeeting((await params).id, user.id);
  return { title: meeting?.title ?? "Meeting" };
}

const SHELLS: Record<MeetingTab, { icon: typeof FileText; title: string; body: string }> = {
  summary: { icon: FileText, title: "No summary yet", body: "Generated summaries with template switching arrive in build steps 2 and 3." },
  actions: { icon: CheckSquare, title: "No action items yet", body: "Extracted, assignable action items arrive in build step 2." },
  transcript: { icon: ScrollText, title: "No transcript yet", body: "The timestamped transcript arrives in build step 2." },
  scratchpad: { icon: NotebookPen, title: "Scratchpad is empty", body: "Notes that feed back into the summary arrive in build step 3." },
};

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function MeetingPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const meeting = await loadMeeting((await params).id, user.id);
  if (!meeting) notFound();

  const tab = parseTab((await searchParams).tab);
  const shell = SHELLS[tab];

  return (
    <>
      <PageHeader
        title={meeting.title}
        meta={
          <>
            <span>{dateFmt.format(meeting.startedAt)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{formatDuration(meeting.durationMs)}</span>
          </>
        }
      />
      <MeetingTabs meetingId={meeting.id} active={tab} />
      <main className="flex-1 overflow-y-auto">
        <EmptyState icon={shell.icon} title={shell.title}>
          {shell.body}
        </EmptyState>
      </main>
    </>
  );
}
