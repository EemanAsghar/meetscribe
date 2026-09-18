"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, Search, X } from "lucide-react";
import { Timestamp } from "@/components/timestamp";
import { speakerColor } from "@/lib/speakers";
import { cn, formatOffset } from "@/lib/utils";

type Segment = { id: string; idx: number; speaker: string; startMs: number; text: string };

/** Splits text around case-insensitive matches so they can be highlighted. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent-ink">{part}</mark> : part));
}

export function TranscriptView({ linkBase, segments, speakers, targetIdx, estimated, audioSrc, targetMs }: {
  /** Everything before the offset in a link to a moment: "/meetings/<id>?tab=transcript&t=" in the app, "/s/<slug>?t=" on a share page. */
  linkBase: string;
  segments: Segment[];
  speakers: string[];
  targetIdx: number | null;
  estimated: boolean;
  /** Owner-only stream of the recording. When set, timestamps seek the player and the spoken line is highlighted. */
  audioSrc?: string;
  targetMs?: number | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);

  const seek = (ms: number) => {
    if (!audio.current) return;
    audio.current.currentTime = ms / 1000;
    void audio.current.play().catch(() => {});
  };

  function onTimeUpdate() {
    const ms = (audio.current?.currentTime ?? 0) * 1000;
    let current: number | null = null;
    for (const s of segments) { if (s.startMs <= ms) current = s.idx; else break; }
    setPlayingIdx(current);
  }
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const q = query.trim();

  const visible = useMemo(
    () => segments.filter((s) => (!speaker || s.speaker === speaker) && (!q || s.text.toLowerCase().includes(q.toLowerCase()))),
    [segments, speaker, q],
  );

  // A citation link lands here: bring its line into view. Filtering is cleared first so the line is not hidden.
  useEffect(() => {
    if (targetIdx === null) return;
    document.getElementById(`seg-${targetIdx}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetIdx]);

  // A citation link opens the recording at that moment, ready to play.
  useEffect(() => {
    if (audio.current && targetMs != null) audio.current.currentTime = targetMs / 1000;
  }, [targetMs]);

  async function copyLink(s: Segment) {
    await navigator.clipboard.writeText(`${window.location.origin}${linkBase}${s.startMs}`);
    setCopied(s.idx);
    setTimeout(() => setCopied((c) => (c === s.idx ? null : c)), 1500);
  }

  const wordsBySpeaker = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of segments) totals.set(s.speaker, (totals.get(s.speaker) ?? 0) + s.text.split(/\s+/).length);
    const all = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
    return new Map([...totals].map(([name, n]) => [name, Math.round((n / all) * 100)]));
  }, [segments]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      <div className="sticky top-0 z-10 -mx-5 mb-3 border-b border-line bg-canvas/95 px-5 pb-2 pt-1 backdrop-blur">
        {audioSrc && <audio ref={audio} src={audioSrc} controls preload="metadata" onTimeUpdate={onTimeUpdate} className="mb-2 h-9 w-full" aria-label="Meeting recording" />}
        <div className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2 focus-within:border-accent">
          <Search className="size-3.5 text-ink-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this transcript…" aria-label="Search this transcript" className="h-7 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none" />
          {(q || speaker) && <span className="tabular text-xs text-ink-3">{visible.length} of {segments.length}</span>}
          {q && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="rounded-sm text-ink-4 hover:text-ink"><X className="size-3.5" /></button>}
        </div>
        {speakers.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {speakers.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSpeaker((cur) => (cur === name ? null : name))}
                aria-pressed={speaker === name}
                title={`${wordsBySpeaker.get(name)}% of the words spoken`}
                className={cn("flex h-5.5 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors", speaker === name ? "border-accent-line bg-accent-soft text-accent-ink" : "border-line bg-surface text-ink-3 hover:text-ink")}
              >
                <span className="size-1.5 rounded-full" style={{ background: speakerColor(name, speakers) }} />
                {name} <span className="tabular text-ink-4">{wordsBySpeaker.get(name)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {estimated && (
        <p className="mb-3 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-3">
          This transcript had no timestamps. Times marked ~ are estimated from word count at 150 words per minute.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-3">Nothing in this transcript matches.</p>
      ) : (
        <ol>
          {visible.map((s, i) => {
            const sameSpeaker = i > 0 && visible[i - 1].speaker === s.speaker && visible[i - 1].idx === s.idx - 1;
            return (
              <li key={s.id} id={`seg-${s.idx}`} className={cn("group -mx-2 flex gap-3 rounded-md px-2 py-1 transition-colors", !sameSpeaker && i > 0 && "mt-2", targetIdx === s.idx && "bg-accent-soft ring-1 ring-accent-line", playingIdx === s.idx && targetIdx !== s.idx && "bg-hover")}>
                {audioSrc ? (
                  <button type="button" onClick={() => seek(s.startMs)} title="Play from here" className="tabular mt-0.5 h-4.5 w-12 shrink-0 rounded-sm text-right font-mono text-2xs font-medium text-ink-4 hover:bg-hover hover:text-accent">{formatOffset(s.startMs)}</button>
                ) : (
                  <Timestamp href={`${linkBase}${s.startMs}`} ms={s.startMs} estimated={estimated} className="mt-0.5 w-12 shrink-0 justify-end bg-transparent text-ink-4 hover:bg-hover" />
                )}
                <div className="min-w-0 flex-1">
                  {!sameSpeaker && <p className="text-xs font-semibold" style={{ color: speakerColor(s.speaker, speakers) }}>{s.speaker}</p>}
                  <p className="text-sm leading-relaxed text-ink">{highlight(s.text, q)}</p>
                </div>
                <button type="button" onClick={() => copyLink(s)} aria-label="Copy a link to this moment" title="Copy a link to this moment" className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-4 opacity-0 transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
                  {copied === s.idx ? <Check className="size-3.5 text-accent" /> : <Link2 className="size-3.5" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
