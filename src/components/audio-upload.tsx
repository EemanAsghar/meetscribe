"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { AlertTriangle, ArrowRight, FileAudio, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_BYTES = 25 * 1024 * 1024;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function AudioUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function choose(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|m4a|wav|webm|ogg|mp4|flac|aac)$/i.test(f.name)) return setError("That does not look like an audio file. MP3, M4A, WAV, WebM and OGG work.");
    if (f.size > MAX_BYTES) return setError(`That file is ${mb(f.size)}. The free transcription service accepts up to 25 MB, about 30 minutes of MP3 at normal quality.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      // Straight from the browser to Blob storage: request bodies through Vercel are capped near 4.5 MB.
      const stored = await upload(`uploads/${file.name.replace(/[^\w.-]+/g, "-")}`, file, {
        access: "private" as "public",
        handleUploadUrl: "/api/blob/upload",
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const res = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "audio", audioUrl: stored.url, title: title || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      router.push(`/meetings/${data.id}`);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "The upload failed.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6">
      <div>
        <label htmlFor="audio-title" className="text-xs font-medium text-ink-2">Title</label>
        <input id="audio-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Leave blank and Meetscribe will name it from the conversation" className="mt-1 h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none" />
      </div>

      <input ref={input} type="file" accept="audio/*,video/webm,video/mp4,.m4a,.mp3,.wav,.ogg,.flac" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent"><FileAudio className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{file.name}</p>
            <p className="tabular text-xs text-ink-3">{mb(file.size)}</p>
            {progress !== null && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>}
          </div>
          {progress === null && <Button variant="ghost" size="icon" aria-label="Choose a different file" onClick={() => setFile(null)}><X /></Button>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files?.[0]); }}
          className={cn("flex h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition-colors", over ? "border-accent bg-accent-soft/50" : "border-line-strong bg-surface hover:border-accent")}
        >
          <FileAudio className="size-6 text-ink-4" />
          <span className="font-medium text-ink">Drop a recording here, or click to choose</span>
          <span className="text-xs text-ink-3">MP3, M4A, WAV, WebM or OGG, up to 25 MB</span>
        </button>
      )}

      <p className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-3">
        Recordings are transcribed with timestamps but <span className="font-medium text-ink-2">without speaker names</span>: the transcription model used here cannot tell voices apart. Pasted transcripts keep their speakers.
      </p>

      {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}</p>}

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-ink-4">Transcription takes a few seconds, the summary about 15 more.</p>
        <Button variant="primary" disabled={!file || progress !== null} onClick={submit}>
          {progress !== null ? <><Loader2 className="animate-spin" /> {progress < 100 ? `Uploading ${Math.round(progress)}%` : "Starting…"}</> : <>Create meeting <ArrowRight /></>}
        </Button>
      </div>
    </div>
  );
}
