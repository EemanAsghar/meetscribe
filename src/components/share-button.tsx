"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, Copy, ExternalLink, Globe, Link2, Lock, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShareButton({ meetingId, initialEnabled, initialSlug, hasSummary }: { meetingId: string; initialEnabled: boolean; initialSlug: string; hasSummary: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = typeof window === "undefined" ? `/s/${slug}` : `${window.location.origin}/s/${slug}`;

  async function update(body: { enabled?: boolean; reset?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update sharing.");
      setEnabled(data.shareEnabled);
      setSlug(data.shareSlug);
      setCopied(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sharing.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button size="sm" variant={enabled ? "soft" : "secondary"}>
          {enabled ? <Globe /> : <Link2 className="text-ink-3" />} {enabled ? "Shared" : "Share"}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-[20vh] z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl bg-surface p-5 shadow-pop focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">Share this meeting</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-ink-3">Anyone with the link can read it. No account needed.</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close"><X /></Button></Dialog.Close>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={() => update({ enabled: !enabled })}
            className="mt-4 flex w-full items-center gap-3 rounded-lg border border-line p-3 text-left transition-colors hover:bg-hover disabled:opacity-60"
          >
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", enabled ? "bg-accent-soft text-accent" : "bg-sunken text-ink-3")}>{enabled ? <Globe className="size-4" /> : <Lock className="size-4" />}</span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">{enabled ? "Public link is on" : "Private"}</span>
              <span className="block text-xs text-ink-3">{enabled ? "Turn off to make the link stop working." : "Only you can see this meeting."}</span>
            </span>
            <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", enabled ? "bg-accent" : "bg-line-strong")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-xs transition-all", enabled ? "left-4.5" : "left-0.5")} />
            </span>
          </button>

          {enabled && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <input readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-sunken px-2 font-mono text-xs text-ink-2 focus:border-accent focus:outline-none" />
                <Button size="md" variant="primary" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy link</>}</Button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Button asChild size="sm" variant="ghost"><a href={`/s/${slug}`} target="_blank" rel="noreferrer"><ExternalLink /> See what others see</a></Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => update({ reset: true })} title="The current link stops working and a new one is made"><RotateCcw /> Reset link</Button>
              </div>
            </>
          )}

          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-ink-3">
            <li><span className="font-medium text-ink-2">Shared:</span> the summary you see, action items and the transcript.</li>
            <li><span className="font-medium text-ink-2">Never shared:</span> your Scratchpad notes and anything you ask Meetscribe.</li>
            {!hasSummary && <li className="text-warn">This meeting has no summary yet, so the link shows the transcript only.</li>}
          </ul>
          {error && <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-warn"><AlertTriangle className="size-4" /> {error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
