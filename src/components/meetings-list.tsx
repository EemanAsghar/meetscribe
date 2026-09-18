"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckSquare, ClipboardPaste, Globe, Loader2, Mic, Search, Upload, X } from "lucide-react";
import { initials, speakerColor } from "@/lib/speakers";
import { cn, formatDuration } from "@/lib/utils";

export type MeetingRow = {
  id: string;
  title: string;
  startedAt: string;
  durationMs: number;
  estimated: boolean;
  source: "scheduled" | "instant" | "upload" | "paste";
  status: "scheduled" | "recording" | "processing" | "ready" | "failed";
  shared: boolean;
  people: string[];
  overview: string | null;
  openItems: number;
  totalItems: number;
};

const SOURCE = {
  scheduled: { icon: CalendarClock, label: "Scheduled meeting" },
  instant: { icon: Mic, label: "Instant meeting" },
  upload: { icon: Upload, label: "Uploaded" },
  paste: { icon: ClipboardPaste, label: "Pasted transcript" },
} as const;

const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

export function MeetingsList({ meetings }: { meetings: MeetingRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = q ? meetings.filter((m) => [m.title, m.overview ?? "", ...m.people].join(" ").toLowerCase().includes(q)) : meetings;
    const byMonth = new Map<string, MeetingRow[]>();
    for (const m of visible) {
      const key = monthFmt.format(new Date(m.startedAt));
      byMonth.set(key, [...(byMonth.get(key) ?? []), m]);
    }
    return [...byMonth.entries()];
  }, [meetings, q]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-4">
      <div className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2 focus-within:border-accent">
        <Search className="size-3.5 text-ink-4" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, person or what was discussed…" aria-label="Filter meetings" className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none" />
        {q && <button type="button" onClick={() => setQuery("")} aria-label="Clear filter" className="rounded-sm text-ink-4 hover:text-ink"><X className="size-3.5" /></button>}
      </div>

      {groups.length === 0 && (
        <p className="py-12 text-center text-sm text-ink-3">
          No meeting matches “{query}”. <Link href={`/ask?q=${encodeURIComponent(query)}`} className="font-medium text-accent underline-offset-2 hover:underline">Ask Meetscribe instead</Link>, it searches what was said.
        </p>
      )}

      {groups.map(([month, rows]) => (
        <section key={month} className="mt-5">
          <h2 className="flex items-center gap-2 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-4">{month} <span className="tabular font-normal">{rows.length}</span></h2>
          <ul className="mt-1 overflow-hidden rounded-lg border border-line bg-surface">
            {rows.map((m) => {
              const Source = SOURCE[m.source];
              const date = new Date(m.startedAt);
              return (
                <li key={m.id} className="border-b border-line last:border-b-0">
                  <Link href={`/meetings/${m.id}`} className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-hover">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-3" title={Source.label}><Source.icon className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{m.title}</span>
                        {m.shared && <span title="Public link is on" className="shrink-0 text-accent"><Globe className="size-3" /></span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-3"><StatusLine meeting={m} /></p>
                    </div>
                    <span className="hidden shrink-0 -space-x-1 sm:flex">
                      {m.people.slice(0, 4).map((p) => (
                        <span key={p} title={p} className="flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-surface" style={{ background: speakerColor(p, m.people) }}>{initials(p)}</span>
                      ))}
                      {m.people.length > 4 && <span className="flex size-5 items-center justify-center rounded-full bg-sunken text-[9px] font-medium text-ink-3 ring-2 ring-surface">+{m.people.length - 4}</span>}
                    </span>
                    <span className={cn("tabular hidden w-14 shrink-0 items-center justify-end gap-1 text-xs md:flex", m.openItems > 0 ? "text-ink-2" : "text-ink-4")} title={m.totalItems ? `${m.openItems} of ${m.totalItems} action items still open` : "No action items"}>
                      <CheckSquare className="size-3" /> {m.totalItems ? `${m.totalItems - m.openItems}/${m.totalItems}` : "–"}
                    </span>
                    <span className="tabular w-14 shrink-0 text-right text-xs text-ink-3">{m.estimated ? "~" : ""}{formatDuration(m.durationMs)}</span>
                    <span className="w-24 shrink-0 text-right text-xs leading-tight text-ink-3">
                      <span className="block text-ink-2">{dayFmt.format(date)}</span>
                      <span className="tabular">{timeFmt.format(date)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatusLine({ meeting: m }: { meeting: MeetingRow }) {
  if (m.status === "processing") return <span className="inline-flex items-center gap-1 text-accent"><Loader2 className="size-3 animate-spin" /> Writing the summary…</span>;
  if (m.status === "failed") return <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle className="size-3" /> The summary could not be generated. Open to try again.</span>;
  if (m.status === "recording") return <span className="inline-flex items-center gap-1 font-medium text-rec"><span className="size-1.5 animate-rec rounded-full bg-rec" /> Meetscribe is recording</span>;
  if (m.overview) return m.overview;
  return <span className="text-ink-4">Transcript saved. No summary yet.</span>;
}
