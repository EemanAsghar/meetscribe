import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowRight, Check, FileText } from "lucide-react";
import { Brand } from "@/components/brand";
import { SummaryBody } from "@/components/summary-body";
import { Timestamp } from "@/components/timestamp";
import { TranscriptView } from "@/components/transcript-view";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/db";
import { initials, speakerColor } from "@/lib/speakers";
import { cn, formatDuration } from "@/lib/utils";

// Public and unauthenticated: excluded from the proxy matcher. Only meetings with share_enabled resolve, and a
// disabled or reset link is indistinguishable from one that never existed (both 404).
//
// It reads the SAME summaries row as the app (current summary of the meeting's active template) and renders it
// with the same component, so the shared view cannot drift from what the owner sees. The Scratchpad is never
// loaded here, and bullets carry no "from your notes" marker.

async function loadShared(slug: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(slug)) return null;
  const [meeting] = await db.select().from(schema.meetings).where(and(eq(schema.meetings.shareSlug, slug), eq(schema.meetings.shareEnabled, true))).limit(1);
  return meeting ?? null;
}

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meeting = await loadShared((await params).slug);
  return { title: meeting?.title ?? "Shared meeting", robots: { index: false, follow: false } };
}

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });
const dueFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function SharePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const meeting = await loadShared(slug);
  if (!meeting) notFound();

  const t = (await searchParams).t;
  const targetMs = t !== undefined && /^\d+$/.test(t) ? Number(t) : null;

  const [segments, actionItems, summaryRows] = await Promise.all([
    db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, meeting.id)).orderBy(asc(schema.transcriptSegments.idx)),
    db.select().from(schema.actionItems).where(eq(schema.actionItems.meetingId, meeting.id)).orderBy(asc(schema.actionItems.sortOrder), asc(schema.actionItems.createdAt)),
    meeting.activeTemplateId
      ? db.select().from(schema.summaries).where(and(eq(schema.summaries.meetingId, meeting.id), eq(schema.summaries.templateId, meeting.activeTemplateId), eq(schema.summaries.isCurrent, true))).orderBy(desc(schema.summaries.createdAt)).limit(1)
      : Promise.resolve([]),
  ]);
  const summary = summaryRows[0] ?? null;
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const target = targetMs === null || segments.length === 0 ? null : (segments.find((s) => s.startMs === targetMs) ?? [...segments].reverse().find((s) => s.startMs <= targetMs) ?? segments[0]).idx;
  const moment = (ms: number) => `/s/${slug}?t=${ms}#transcript`;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="rounded-sm"><Brand /></Link>
          <Button asChild size="sm" variant="ghost"><Link href="/login">Try Meetscribe <ArrowRight /></Link></Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <p className="text-2xs font-semibold uppercase tracking-wider text-accent">Shared meeting notes</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{meeting.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
          <span>{dateFmt.format(meeting.startedAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular">{meeting.timestampsEstimated ? "~" : ""}{formatDuration(meeting.durationMs)}</span>
          {speakers.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5">
                <span className="flex -space-x-1">
                  {speakers.slice(0, 5).map((s) => (
                    <span key={s} title={s} className="flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent ring-2 ring-canvas" style={{ background: speakerColor(s, speakers) }}>{initials(s)}</span>
                  ))}
                </span>
                {speakers.slice(0, 3).join(", ")}{speakers.length > 3 ? ` and ${speakers.length - 3} more` : ""}
              </span>
            </>
          )}
        </div>

        <section className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-xs">
          {summary ? (
            <SummaryBody content={summary.content} estimated={meeting.timestampsEstimated} momentHref={moment} />
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-3"><FileText className="size-4" /> No summary has been written for this meeting yet. The transcript is below.</p>
          )}
        </section>

        {actionItems.length > 0 && (
          <section className="mt-8">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">Action items</h2>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
              {actionItems.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border", item.done ? "border-accent bg-accent text-on-accent" : "border-line-strong")} aria-label={item.done ? "Done" : "Not done"}>
                    {item.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm text-ink", item.done && "text-ink-4 line-through")}>{item.text}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <span className={cn("rounded-sm px-1.5 py-px font-medium", item.assigneeName ? "bg-sunken text-ink-2" : "text-ink-4")}>{item.assigneeName ?? "Unassigned"}</span>
                      {item.dueDate && <span className="tabular">Due {dueFmt.format(new Date(`${item.dueDate}T00:00:00Z`))}</span>}
                      {item.sourceMs !== null && <Timestamp href={moment(item.sourceMs)} ms={item.sourceMs} estimated={meeting.timestampsEstimated} />}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {segments.length > 0 && (
          <section id="transcript" className="mt-10 scroll-mt-16">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">Transcript</h2>
            <div className="-mx-5 mt-1">
              <TranscriptView linkBase={`/s/${slug}?t=`} speakers={speakers} estimated={meeting.timestampsEstimated} targetIdx={target} segments={segments.map((s) => ({ id: s.id, idx: s.idx, speaker: s.speaker, startMs: s.startMs, text: s.text }))} />
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <p className="text-xs text-ink-3">Notes taken by <span className="font-medium text-ink-2">Meetscribe</span>. Every point links to the moment it was said.</p>
          <Button asChild size="sm" variant="secondary"><Link href="/login">Get notes like these <ArrowRight /></Link></Button>
        </div>
      </footer>
    </div>
  );
}
