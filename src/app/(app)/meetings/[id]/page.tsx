import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { AlertTriangle, FileText, Loader2, MessageSquareText, NotebookPen, Sparkles } from "lucide-react";
import { ActionItems } from "@/components/action-items";
import { CopyButton } from "@/components/copy-button";
import { MeetingTabs, parseTab } from "@/components/meeting-tabs";
import { PageHeader } from "@/components/page-header";
import { ProcessingPoller } from "@/components/processing-poller";
import { ScratchpadEditor } from "@/components/scratchpad-editor";
import { SummaryControls } from "@/components/summary-controls";
import { Timestamp } from "@/components/timestamp";
import { TranscriptView } from "@/components/transcript-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import type { ActionItem, Meeting, Summary, TranscriptSegment } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { initials, speakerColor } from "@/lib/speakers";
import { cn, formatDuration, formatOffset } from "@/lib/utils";

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

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function MeetingPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const meeting = await loadMeeting((await params).id, user.id);
  if (!meeting) notFound();

  const query = await searchParams;
  const tab = parseTab(query.tab);
  const targetMs = query.t !== undefined && /^\d+$/.test(query.t) ? Number(query.t) : null;

  const [segments, actionItems, summaryRows] = await Promise.all([
    db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, meeting.id)).orderBy(asc(schema.transcriptSegments.idx)),
    db.select().from(schema.actionItems).where(eq(schema.actionItems.meetingId, meeting.id)).orderBy(asc(schema.actionItems.sortOrder), asc(schema.actionItems.createdAt)),
    meeting.activeTemplateId
      ? db
          .select()
          .from(schema.summaries)
          .where(and(eq(schema.summaries.meetingId, meeting.id), eq(schema.summaries.templateId, meeting.activeTemplateId), eq(schema.summaries.isCurrent, true)))
          .orderBy(desc(schema.summaries.createdAt))
          .limit(1)
      : Promise.resolve([] as Summary[]),
  ]);
  const summary = summaryRows[0] ?? null;
  const [templates, [pad], currentSummaries] = await Promise.all([
    db.select().from(schema.templates).orderBy(asc(schema.templates.sortOrder)),
    db.select().from(schema.scratchpads).where(eq(schema.scratchpads.meetingId, meeting.id)).limit(1),
    db
      .select({ templateId: schema.summaries.templateId, notesVersionUsed: schema.summaries.notesVersionUsed })
      .from(schema.summaries)
      .where(and(eq(schema.summaries.meetingId, meeting.id), eq(schema.summaries.isCurrent, true))),
  ]);
  const notesVersion = pad?.version ?? 0;
  // Stale = the notes were saved after this summary was generated (SPEC.md section 4).
  const notesChanged = summary !== null && notesVersion > summary.notesVersionUsed;
  const templateOptions = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ready: currentSummaries.some((c) => c.templateId === t.id && c.notesVersionUsed === notesVersion),
  }));
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const processing = meeting.status === "processing";
  // Who an action item can be given to: the people in this meeting first, then the rest of the workspace.
  const workspace = await db.select({ name: schema.users.name }).from(schema.users);
  const people = [...new Set([...speakers.filter((n) => n !== "Speaker"), ...workspace.map((u) => u.name)])];

  return (
    <>
      {processing && <ProcessingPoller />}
      <PageHeader
        title={meeting.title}
        meta={
          <>
            <span>{dateFmt.format(meeting.startedAt)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{meeting.timestampsEstimated ? "~" : ""}{formatDuration(meeting.durationMs)}</span>
            {speakers.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="flex -space-x-1">
                  {speakers.slice(0, 5).map((s) => (
                    <span key={s} title={s} className="flex size-4.5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-surface" style={{ background: speakerColor(s, speakers) }}>
                      {initials(s)}
                    </span>
                  ))}
                </span>
              </>
            )}
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link href={`/ask?meeting=${meeting.id}`}>
              <MessageSquareText className="text-accent" /> Ask about this meeting
            </Link>
          </Button>
        }
      />
      <MeetingTabs meetingId={meeting.id} active={tab} counts={{ actions: actionItems.length || undefined }} />
      <main className="flex-1 overflow-y-auto">
        {meeting.status === "failed" && (tab === "summary" || tab === "actions") ? (
          <>
            <SummaryControls meetingId={meeting.id} templates={templateOptions} activeTemplateId={meeting.activeTemplateId} notesChanged={false} failed />
            <EmptyState icon={AlertTriangle} title="The summary could not be generated">
              The AI models were busy or out of free quota. Your transcript is saved, so nothing is lost. Try again in a minute.
            </EmptyState>
          </>
        ) : tab === "summary" ? (
          <>
            {!processing && (
              <SummaryControls meetingId={meeting.id} templates={templateOptions} activeTemplateId={meeting.activeTemplateId} notesChanged={notesChanged} missing={!summary}>
                {summary && <CopyButton label="Copy as Markdown" text={summaryMarkdown(meeting, summary, actionItems)} />}
              </SummaryControls>
            )}
            <SummaryTab meeting={meeting} summary={summary} processing={processing} hasTranscript={segments.length > 0} />
          </>
        ) : tab === "actions" ? (
          processing && actionItems.length === 0 ? (
            <Generating label="Looking for commitments people made…" />
          ) : (
            <ActionItems
              key={actionItems.map((a) => a.id).join()}
              meetingId={meeting.id}
              people={people}
              estimated={meeting.timestampsEstimated}
              initial={actionItems.map((a) => ({ id: a.id, text: a.text, assigneeName: a.assigneeName, dueDate: a.dueDate, done: a.done, sourceMs: a.sourceMs, origin: a.origin }))}
            />
          )
        ) : tab === "transcript" ? (
          <TranscriptView
            meetingId={meeting.id}
            speakers={speakers}
            estimated={meeting.timestampsEstimated}
            targetIdx={targetSegment(segments, targetMs)}
            segments={segments.map((s) => ({ id: s.id, idx: s.idx, speaker: s.speaker, startMs: s.startMs, text: s.text }))}
          />
        ) : (
          <ScratchpadEditor key={meeting.id} meetingId={meeting.id} initialContent={pad?.content ?? ""} summaryIsStale={notesChanged} />
        )}
      </main>
    </>
  );
}

function Generating({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <Loader2 className="size-4 animate-spin text-accent" /> {label}
      </p>
      <div className="mt-6 space-y-3" aria-hidden>
        {[92, 78, 85, 60, 88, 70].map((w, i) => (
          <div key={i} className="h-3 animate-pulse rounded-sm bg-sunken" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}

function SummaryTab({ meeting, summary, processing, hasTranscript }: { meeting: Meeting; summary: Summary | null; processing: boolean; hasTranscript: boolean }) {
  if (!summary) {
    if (processing) return <Generating label="Reading the transcript and writing the summary…" />;
    return (
      <EmptyState icon={FileText} title="No summary yet">
        {hasTranscript
          ? "The transcript is saved and searchable, and you can already ask questions about it. Pick a template above and generate the summary when you want it."
          : "This meeting has no transcript yet."}
      </EmptyState>
    );
  }
  const { overview, sections } = summary.content;
  return (
    <article className="mx-auto max-w-3xl px-5 py-6">
      <p className="text-base leading-relaxed text-ink-2">{overview}</p>
      {sections.filter((s) => s.bullets.length > 0).map((section) => (
        <section key={section.key} className="mt-7">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{section.title}</h2>
          <ul className="mt-2 space-y-2.5">
            {section.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span className={cn("mt-2 size-1 shrink-0 rounded-full", b.from_notes ? "bg-note" : "bg-ink-4")} aria-hidden />
                <span>
                  {b.text}{" "}
                  <span className="ml-0.5 inline-flex flex-wrap gap-1 align-middle">
                    {b.from_notes && (
                      <Link
                        href={`/meetings/${meeting.id}?tab=scratchpad`}
                        title="This point comes from your Scratchpad notes"
                        className="inline-flex h-4.5 items-center gap-1 rounded-sm bg-note-soft px-1 text-2xs font-medium text-note transition-colors hover:bg-note/15"
                      >
                        <NotebookPen className="size-2.5" /> From your notes
                      </Link>
                    )}
                    {b.source_ms.map((ms) => <Timestamp key={ms} meetingId={meeting.id} ms={ms} estimated={meeting.timestampsEstimated} />)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-8 flex items-center gap-1.5 border-t border-line pt-3 text-2xs text-ink-4" title={`Generated by ${summary.model}`}>
        <Sparkles className="size-3" /> Every point links to the moment it was said. Generated by <span className="font-mono">{summary.model}</span>
        {summary.notesVersionUsed > 0 ? ", using your notes." : "."}
      </p>
    </article>
  );
}

/** Offsets are unique per segment, so a citation resolves exactly. A hand-typed t falls back to the last segment at or before it. */
function targetSegment(segments: TranscriptSegment[], targetMs: number | null): number | null {
  if (targetMs === null || segments.length === 0) return null;
  return (segments.find((s) => s.startMs === targetMs) ?? [...segments].reverse().find((s) => s.startMs <= targetMs) ?? segments[0]).idx;
}

/** What "Copy as Markdown" puts on the clipboard: paste-ready for a doc, an email or a ticket. */
function summaryMarkdown(meeting: Meeting, summary: Summary, items: ActionItem[]): string {
  const lines = [`# ${meeting.title}`, `${dateFmt.format(meeting.startedAt)} · ${formatDuration(meeting.durationMs)}`, "", summary.content.overview, ""];
  for (const section of summary.content.sections) {
    if (section.bullets.length === 0) continue;
    lines.push(`## ${section.title}`, ...section.bullets.map((b) => `- ${b.text}${b.source_ms.length ? ` (${b.source_ms.map(formatOffset).join(", ")})` : ""}`), "");
  }
  if (items.length) lines.push("## Action items", ...items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}${i.assigneeName ? ` — ${i.assigneeName}` : ""}${i.dueDate ? ` (due ${i.dueDate})` : ""}`), "");
  return lines.join("\n").trim() + "\n";
}
