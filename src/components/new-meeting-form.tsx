"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Clock, FileUp, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FORMAT_LABELS, TranscriptError, parseTranscript } from "@/lib/transcript/parse";
import { cn, formatDuration } from "@/lib/utils";

const PLACEHOLDER = `Paste a transcript. Any of these work:

[00:03] Priya: Let's start with the launch date.
0:03 - Priya Raman
Priya: Let's start with the launch date.
…or a .vtt / .srt caption file, or plain text.`;

export function NewMeetingForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [source, setSource] = useState<"paste" | "upload">("paste");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same pure parser the server uses, so the preview cannot disagree with what gets stored.
  const preview = useMemo(() => {
    if (!transcript.trim()) return null;
    try {
      return { ok: true as const, ...parseTranscript(transcript) };
    } catch (e) {
      return { ok: false as const, message: e instanceof TranscriptError ? e.message : "Could not read this transcript." };
    }
  }, [transcript]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 600_000) return setError("That file is too large. Transcripts up to 600 KB are supported.");
    setTranscript(await file.text());
    setSource("upload");
    setError(null);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, title: title || undefined, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      router.push(`/meetings/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6">
      <div>
        <label htmlFor="title" className="text-xs font-medium text-ink-2">Title</label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave blank and Meetscribe will name it from the conversation"
          maxLength={160}
          className="mt-1 h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <div className="flex items-end justify-between">
          <label htmlFor="transcript" className="text-xs font-medium text-ink-2">Transcript</label>
          <input ref={fileInput} type="file" accept=".txt,.vtt,.srt,.md,text/plain,text/vtt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
            <FileUp /> Upload .txt, .vtt or .srt
          </Button>
        </div>
        <textarea
          id="transcript"
          value={transcript}
          onChange={(e) => { setTranscript(e.target.value); setSource("paste"); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          className="mt-1 h-80 w-full resize-y rounded-md border border-line-strong bg-surface p-3 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
      </div>

      <div className={cn("flex min-h-9 items-center gap-4 rounded-md border px-3 text-xs", preview?.ok === false ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-sunken text-ink-3")}>
        {!preview && <span>The format is detected as you paste.</span>}
        {preview?.ok === false && <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5" /> {preview.message}</span>}
        {preview?.ok && (
          <>
            <span className="font-medium text-ink">{FORMAT_LABELS[preview.format]}</span>
            <span className="tabular">{preview.segments.length} turns</span>
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {preview.speakers.join(", ")}</span>
            <span className="tabular ml-auto flex items-center gap-1">
              <Clock className="size-3.5" /> {preview.timestampsEstimated ? "~" : ""}{formatDuration(preview.durationMs)}
              {preview.timestampsEstimated && <span className="text-ink-4">(no timestamps found, estimated)</span>}
            </span>
          </>
        )}
      </div>

      {error && <p role="alert" className="flex items-center gap-1.5 text-sm text-warn"><AlertTriangle className="size-4" /> {error}</p>}

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-ink-4">Summary and action items take about 15 seconds.</p>
        <Button type="submit" variant="primary" disabled={submitting || !preview?.ok}>
          {submitting ? <><Loader2 className="animate-spin" /> Saving…</> : <>Create meeting <ArrowRight /></>}
        </Button>
      </div>
    </form>
  );
}
