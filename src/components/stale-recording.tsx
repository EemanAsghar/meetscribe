"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Radio, Square } from "lucide-react";
import { useRecording } from "@/components/recording";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shown on a meeting whose status is "recording".
 *
 * If THIS tab is the one recording, the indicator at the top has the Stop button. If it is not (the tab was closed
 * or reloaded, the browser crashed, or the recording was started on another device), nothing is capturing any more:
 * a browser releases the microphone the moment its tab goes away. The row would then say "recording" for ever, so
 * this offers a way to end it.
 */
export function RecordingState({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const { phase } = useRecording();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingHere = phase === "recording" || phase === "starting" || phase === "saving";

  async function end() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: "The recording was ended from another tab, so its audio was not saved." }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not end the recording.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the recording.");
      setBusy(false);
    }
  }

  if (recordingHere) {
    return (
      <EmptyState icon={Radio} title="Meetscribe is recording this meeting">
        Press <span className="font-medium text-ink-2">Stop</span> in the indicator at the top of the screen when you are done. It stays visible wherever you go. The transcript and summary appear here afterwards.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={AlertTriangle}
      title="This recording is not running in this tab"
      action={<Button variant="primary" disabled={busy} onClick={end}><Square className="fill-current" /> {busy ? "Ending…" : "End this recording"}</Button>}
    >
      If it is still running in another tab or window, press Stop there and it will be saved. If that tab was closed or reloaded, nothing is being captured any more and the audio was not saved: end it here so it stops showing as recording.
      {error && <span className="mt-2 block text-warn">{error}</span>}
    </EmptyState>
  );
}
