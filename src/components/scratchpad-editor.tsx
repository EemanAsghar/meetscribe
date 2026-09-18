"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const PLACEHOLDER = `Type during or after the call. For example:

Correction: the launch is March 17th, not the 3rd.
Priya owns the pricing deck, not Marcus.
Follow up with legal about the reseller clause.`;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function ScratchpadEditor({ meetingId, initialContent, summaryIsStale }: { meetingId: string; initialContent: string; summaryIsStale: boolean }) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [state, setState] = useState<SaveState>("idle");
  const [stale, setStale] = useState(summaryIsStale);
  const saved = useRef(initialContent);
  const latest = useRef(initialContent);
  // Kept in a ref so save() and the pagehide handler always see the newest text, not the text of their render.
  useEffect(() => {
    latest.current = content;
  }, [content]);

  async function save(text = latest.current) {
    if (text === saved.current) return setState("idle");
    setState("saving");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/scratchpad`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error();
      saved.current = text;
      // If the user kept typing while the request was in flight, the debounce below saves again.
      setState(latest.current === text ? "saved" : "dirty");
      setStale(true);
      router.refresh();
    } catch {
      setState("error");
    }
  }

  // Autosave 800 ms after the last keystroke.
  useEffect(() => {
    if (content === saved.current) return;
    setState("dirty");
    const id = setTimeout(() => save(content), 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // A closing tab must not lose the last few words.
  useEffect(() => {
    const flush = () => {
      if (latest.current === saved.current) return;
      fetch(`/api/meetings/${meetingId}/scratchpad`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: latest.current }) });
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [meetingId]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          Your notes are an input to the summary. Where they disagree with the transcript, <span className="font-medium text-ink-2">your notes win</span>.
        </p>
        <span className="flex h-5 shrink-0 items-center gap-1 text-xs text-ink-4" aria-live="polite">
          {state === "saving" && <><Loader2 className="size-3 animate-spin" /> Saving…</>}
          {state === "saved" && <><Check className="size-3 text-accent" /> Saved</>}
          {state === "dirty" && "Unsaved changes"}
          {state === "error" && <button type="button" onClick={() => save(content)} className="flex items-center gap-1 text-warn underline-offset-2 hover:underline"><AlertTriangle className="size-3" /> Not saved. Retry</button>}
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => save(content)}
        placeholder={PLACEHOLDER}
        maxLength={50_000}
        aria-label="Scratchpad"
        className="mt-2 min-h-72 flex-1 resize-none rounded-md border border-line-strong bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
      />

      {stale && content.trim() !== "" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-note/25 bg-note-soft px-3 py-2">
          <p className="text-sm text-ink-2">The summary has not seen these notes yet.</p>
          <Button asChild size="sm">
            <Link href={`/meetings/${meetingId}?tab=summary`}>Go to summary <ArrowRight /></Link>
          </Button>
        </div>
      )}
    </div>
  );
}
