"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, ArrowUp, CornerDownRight, Loader2, MessageSquareText, NotebookPen, Search, X } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn, formatOffset } from "@/lib/utils";

type Source = { n: number; id: string; meetingId: string; meetingTitle: string; meetingDate: string; kind: "transcript" | "note"; startMs: number | null; speakerLabel: string | null; text: string };
type Citation = { n: number; meeting_id: string; chunk_id: string; start_ms: number; speaker: string | null; quote: string };
type Exchange = { id: number; question: string; text: string; sources: Source[]; citations: Citation[] | null; model: string | null; keywordOnly: boolean; status: "searching" | "streaming" | "done" | "error"; error?: string; removed?: number };

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function AskChat({ suggestions, scopeMeeting, initialQuestion }: { suggestions: string[]; scopeMeeting: { id: string; title: string } | null; initialQuestion?: string }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState(scopeMeeting);
  const threadId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const busy = exchanges.some((e) => e.status === "searching" || e.status === "streaming");

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [exchanges]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    const id = Date.now();
    const patch = (p: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) =>
      setExchanges((all) => all.map((e) => (e.id === id ? { ...e, ...(typeof p === "function" ? p(e) : p) } : e)));
    setExchanges((all) => [...all, { id, question, text: "", sources: [], citations: null, model: null, keywordOnly: false, status: "searching" }]);
    setInput("");

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, threadId: threadId.current ?? undefined, scope: scope ? { meeting_ids: [scope.id] } : undefined }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "sources") {
            threadId.current = event.threadId;
            patch({ sources: event.sources, keywordOnly: event.keywordOnly, status: "streaming" });
          } else if (event.type === "token") patch((e) => ({ text: e.text + event.text }));
          // The validated text replaces the streamed text: citations that pointed nowhere are gone from it.
          else if (event.type === "done") patch({ text: event.text, citations: event.citations, model: event.model, removed: event.removed, status: "done" });
          else if (event.type === "error") patch({ status: "error", error: event.message });
        }
      }
    } catch (e) {
      patch({ status: "error", error: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  // /ask?q=... (from the ⌘K palette) asks immediately, once.
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <Tooltip.Provider delayDuration={120}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-6">
            {exchanges.length === 0 ? (
              <div className="pt-10 text-center">
                <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <MessageSquareText className="size-5" strokeWidth={1.75} />
                </div>
                <h2 className="text-lg font-semibold text-ink">{scope ? "Ask about this meeting" : "Ask across every meeting"}</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">
                  Every claim in the answer links to the moment it was said. If your meetings don&apos;t contain the answer, Meetscribe says so.
                </p>
                <div className="mx-auto mt-6 flex max-w-xl flex-col gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-sm text-ink-2 shadow-xs transition-colors hover:border-accent-line hover:bg-accent-soft/40 hover:text-ink">
                      <CornerDownRight className="size-3.5 shrink-0 text-ink-4" /> {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {exchanges.map((e) => <ExchangeView key={e.id} exchange={e} />)}
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-surface">
          <form onSubmit={(ev) => { ev.preventDefault(); ask(input); }} className="mx-auto max-w-3xl px-5 py-3">
            <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-surface p-1.5 shadow-xs focus-within:border-accent">
              <textarea
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ask(input); } }}
                rows={1}
                maxLength={500}
                placeholder={scope ? `Ask about "${scope.title}"…` : "Ask anything about your meetings…"}
                aria-label="Your question"
                className="max-h-32 min-h-7 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink placeholder:text-ink-4 focus:outline-none"
              />
              <Button type="submit" variant="primary" size="icon" disabled={busy || input.trim().length < 2} aria-label="Ask">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-2xs text-ink-4">
              <Search className="size-3" />
              {scope ? (
                <span className="flex items-center gap-1 rounded-sm bg-accent-soft px-1.5 py-px font-medium text-accent-ink">
                  Only: {scope.title}
                  <button type="button" onClick={() => { setScope(null); threadId.current = null; }} aria-label="Search all meetings instead" className="rounded-sm hover:bg-accent-line"><X className="size-3" /></button>
                </span>
              ) : (
                <span>Searching all your meetings and notes</span>
              )}
            </div>
          </form>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function ExchangeView({ exchange: e }: { exchange: Exchange }) {
  const citedMeetings = groupByMeeting(e);
  return (
    <section>
      <h3 className="text-base font-semibold text-ink">{e.question}</h3>
      <div className="mt-3 flex gap-3">
        <BrandMark className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          {e.status === "searching" && <p className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-3.5 animate-spin text-accent" /> Searching your meetings…</p>}
          {e.status === "error" && <p role="alert" className="flex items-start gap-1.5 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {e.error}</p>}
          {e.text && <AnswerText exchange={e} />}
          {e.status === "streaming" && !e.text && <p className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-3.5 animate-spin text-accent" /> Reading {e.sources.length} excerpts from {new Set(e.sources.map((s) => s.meetingId)).size} meeting{new Set(e.sources.map((s) => s.meetingId)).size === 1 ? "" : "s"}…</p>}

          {e.status === "done" && citedMeetings.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-4">Sources</p>
              <ul className="mt-1.5 space-y-1">
                {citedMeetings.map((m) => (
                  <li key={m.meetingId} className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <Link href={`/meetings/${m.meetingId}`} className="font-medium text-ink-2 underline-offset-2 hover:text-accent hover:underline">{m.title}</Link>
                    <span className="text-ink-4">{dateFmt.format(new Date(m.date))}</span>
                    {m.citations.map((c) => <CitationChip key={c.n} n={c.n} exchange={e} />)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.status === "done" && (
            <p className="mt-2 text-2xs text-ink-4">
              {e.keywordOnly && "Keyword search only (semantic search was unavailable). "}
              {e.model ? <>Answered by <span className="font-mono">{e.model}</span> from {e.sources.length} excerpts.</> : "No relevant excerpts were found, so no AI model was called."}
              {e.removed ? ` ${e.removed} citation${e.removed === 1 ? "" : "s"} removed because ${e.removed === 1 ? "it" : "they"} pointed at nothing.` : ""}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function groupByMeeting(e: Exchange) {
  const groups = new Map<string, { meetingId: string; title: string; date: string; citations: Citation[] }>();
  for (const c of e.citations ?? []) {
    const source = e.sources.find((s) => s.n === c.n);
    if (!source) continue;
    const g = groups.get(c.meeting_id) ?? { meetingId: c.meeting_id, title: source.meetingTitle, date: source.meetingDate, citations: [] };
    g.citations.push(c);
    groups.set(c.meeting_id, g);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Minimal formatting: paragraphs, "- " lists, **bold**, and [n] citation chips. */
function AnswerText({ exchange: e }: { exchange: Exchange }) {
  const inline = (text: string, key: string) =>
    // "lost [1]." -> the chip hugs the word and the full stop hugs the chip.
    text.replace(/\s+(?=\[\d+\])/g, "").split(/(\[\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) return <CitationChip key={`${key}-${i}`} n={Number(cite[1])} exchange={e} />;
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });

  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    blocks.push(<ul key={`l${blocks.length}`} className="my-2 space-y-1.5">{items.map((li, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 size-1 shrink-0 rounded-full bg-ink-4" aria-hidden /><span>{inline(li, `li${blocks.length}-${i}`)}</span></li>)}</ul>);
    list = [];
  };
  e.text.split("\n").forEach((line) => {
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) return void list.push(bullet[1]);
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`} className="my-2 first:mt-0">{inline(line, `p${blocks.length}`)}</p>);
  });
  flush();
  return <div className="text-sm leading-relaxed text-ink">{blocks}{e.status === "streaming" && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-accent" aria-hidden />}</div>;
}

/**
 * While streaming, a chip resolves to its source chunk. Once the answer is validated it resolves to the exact
 * transcript line. A number with no source behind it renders nothing at all.
 */
function CitationChip({ n, exchange: e }: { n: number; exchange: Exchange }) {
  const source = e.sources.find((s) => s.n === n);
  if (!source) return null;
  const citation = e.citations?.find((c) => c.n === n);
  if (e.status === "done" && !citation) return null;

  const isNote = source.kind === "note";
  const ms = citation ? citation.start_ms : source.startMs;
  const href = isNote ? `/meetings/${source.meetingId}?tab=scratchpad` : `/meetings/${source.meetingId}?tab=transcript&t=${ms ?? 0}`;
  const quote = citation?.quote ?? source.text.slice(0, 220);
  const speaker = isNote ? "Your Scratchpad notes" : (citation?.speaker ?? source.speakerLabel);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Link
          href={href}
          className={cn(
            "tabular ml-1 inline-flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded-sm px-1 align-[1px] font-mono text-2xs font-medium transition-colors",
            isNote ? "bg-note-soft text-note hover:bg-note/15" : "bg-accent-soft text-accent-ink hover:bg-accent-line",
          )}
        >
          {isNote && <NotebookPen className="size-2.5" />}
          {n}
        </Link>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="z-50 w-80 rounded-lg bg-surface p-3 text-left shadow-pop">
          <p className="flex items-center justify-between gap-2 text-2xs text-ink-3">
            <span className="truncate font-medium text-ink-2">{source.meetingTitle}</span>
            <span className="tabular shrink-0 font-mono">{isNote ? "notes" : formatOffset(ms ?? 0)}</span>
          </p>
          <p className="mt-1.5 border-l-2 border-accent-line pl-2 text-xs leading-relaxed text-ink">
            <span className="font-semibold">{speaker}:</span> {quote}{quote.length >= 220 ? "…" : ""}
          </p>
          <p className="mt-2 text-2xs text-ink-4">{isNote ? "Click to open the notes" : "Click to open this moment in the transcript"}</p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
