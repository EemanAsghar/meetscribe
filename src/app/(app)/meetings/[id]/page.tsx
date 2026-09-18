import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { AlertTriangle, CheckSquare, FileText, Loader2, NotebookPen, Sparkles } from "lucide-react";
import { MeetingTabs, parseTab } from "@/components/meeting-tabs";
import { PageHeader } from "@/components/page-header";
import { ProcessingPoller } from "@/components/processing-poller";
import { ScratchpadEditor } from "@/components/scratchpad-editor";
import { ScrollIntoView } from "@/components/scroll-into-view";
import { SummaryControls } from "@/components/summary-controls";
import { Timestamp } from "@/components/timestamp";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import type { ActionItem, Meeting, Summary, TranscriptSegment } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { initials, speakerColor } from "@/lib/speakers";
import { cn, formatDuration } from "@/lib/utils";

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
const dueFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

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
            {summary && <SummaryControls meetingId={meeting.id} templates={templateOptions} activeTemplateId={meeting.activeTemplateId} notesChanged={notesChanged} />}
            <SummaryTab meeting={meeting} summary={summary} processing={processing} />
          </>
        ) : tab === "actions" ? (
          <ActionsTab meeting={meeting} items={actionItems} processing={processing} />
        ) : tab === "transcript" ? (
          <TranscriptTab meeting={meeting} segments={segments} speakers={speakers} targetMs={targetMs} />
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

function SummaryTab({ meeting, summary, processing }: { meeting: Meeting; summary: Summary | null; processing: boolean }) {
  if (!summary) {
    return processing ? <Generating label="Reading the transcript and writing the summary…" /> : <EmptyState icon={FileText} title="No summary yet" />;
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

function ActionsTab({ meeting, items, processing }: { meeting: Meeting; items: ActionItem[]; processing: boolean }) {
  if (items.length === 0) {
    return processing ? <Generating label="Looking for commitments people made…" /> : (
      <EmptyState icon={CheckSquare} title="No action items">Nobody committed to anything in this meeting.</EmptyState>
    );
  }
  return (
    <ul className="mx-auto max-w-3xl divide-y divide-line px-5 py-3">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-2.5">
          <span className={cn("mt-0.5 size-4 shrink-0 rounded-sm border border-line-strong", item.done && "border-accent bg-accent")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm text-ink", item.done && "text-ink-4 line-through")}>{item.text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className={cn("rounded-sm px-1.5 py-px font-medium", item.assigneeName ? "bg-sunken text-ink-2" : "text-ink-4")}>{item.assigneeName ?? "Unassigned"}</span>
              {item.dueDate && <span className="tabular">Due {dueFmt.format(new Date(`${item.dueDate}T00:00:00Z`))}</span>}
              {item.sourceMs !== null && <Timestamp meetingId={meeting.id} ms={item.sourceMs} estimated={meeting.timestampsEstimated} />}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TranscriptTab({ meeting, segments, speakers, targetMs }: { meeting: Meeting; segments: TranscriptSegment[]; speakers: string[]; targetMs: number | null }) {
  // Offsets are unique per segment, so a citation resolves exactly. A hand-typed t falls back to the
  // last segment that starts at or before it.
  const target =
    targetMs === null
      ? null
      : (segments.find((s) => s.startMs === targetMs) ?? [...segments].reverse().find((s) => s.startMs <= targetMs) ?? segments[0] ?? null);
  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      {target && <ScrollIntoView targetId={`seg-${target.idx}`} />}
      {meeting.timestampsEstimated && (
        <p className="mb-3 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-3">
          This transcript had no timestamps. Times marked ~ are estimated from word count at 150 words per minute.
        </p>
      )}
      <ol>
        {segments.map((s, i) => {
          const sameSpeaker = i > 0 && segments[i - 1].speaker === s.speaker;
          return (
            <li key={s.id} id={`seg-${s.idx}`} className={cn("-mx-2 flex gap-3 rounded-md px-2 py-1 transition-colors", !sameSpeaker && i > 0 && "mt-2", target?.idx === s.idx && "bg-accent-soft ring-1 ring-accent-line")}>
              <Timestamp meetingId={meeting.id} ms={s.startMs} estimated={meeting.timestampsEstimated} className="mt-0.5 w-12 shrink-0 justify-end bg-transparent text-ink-4 hover:bg-hover" />
              <div className="min-w-0 flex-1">
                {!sameSpeaker && <p className="text-xs font-semibold" style={{ color: speakerColor(s.speaker, speakers) }}>{s.speaker}</p>}
                <p className="text-sm leading-relaxed text-ink">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
