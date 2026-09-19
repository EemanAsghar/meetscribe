"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { AlertTriangle, CalendarClock, Loader2, Mic, MonitorUp, Square, X } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { formatOffset } from "@/lib/utils";

// Capture lives in the app layout, not in a page, so moving around the app never interrupts a recording,
// and the indicator is on every screen (top centre: the one spot no page uses, so it never covers an input). This is the fix for the gap observed in Fathom, where an instant
// meeting was captured with no visible branding: here there is no way to record without this indicator.

const MAX_BYTES = 25 * 1024 * 1024;
const WARN_BYTES = 20 * 1024 * 1024;

type Phase = "idle" | "starting" | "recording" | "saving";
type Upcoming = { id: string; title: string; startsAt: string };
/** "mic": your microphone. "tab": the audio of another browser tab (a Meet, Zoom or Teams call) mixed with your microphone. */
export type CaptureMode = "mic" | "tab";
type StartOptions = { meetingId?: string; title?: string; mode?: CaptureMode };
type Ctx = { phase: Phase; start: (opts?: StartOptions) => Promise<void>; error: string | null };

class CaptureError extends Error {}

/**
 * Opens the audio to record and returns one stream plus a cleanup function.
 *
 * Tab mode is how Meetscribe hears everyone on a call without a bot: the browser's own screen-share picker lets the
 * user choose the tab the call is in and tick "Also share tab audio". That audio is mixed with the microphone through
 * Web Audio, because the tab carries the other participants and the microphone carries the user. Only audio is
 * recorded; the video track the picker insists on is kept alive (ending it can end the capture) and never stored.
 */
async function openCapture(mode: CaptureMode, onEnded: () => void): Promise<{ stream: MediaStream; cleanup: () => void; label: string }> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia || typeof MediaRecorder === "undefined") throw new CaptureError("This browser cannot record audio. Upload an audio file instead.");

  if (mode === "mic") {
    let mic: MediaStream;
    try {
      mic = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      throw new CaptureError("Meetscribe needs microphone access to record. Allow it in your browser, or upload an audio file instead.");
    }
    return { stream: mic, cleanup: () => mic.getTracks().forEach((t) => t.stop()), label: "microphone" };
  }

  if (!media.getDisplayMedia) throw new CaptureError("This browser cannot share a tab's audio. Use Chrome or Edge on a computer, or record your microphone instead.");
  let tab: MediaStream;
  try {
    tab = await media.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 5 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome hints: offer tabs first, and do not offer this tab (recording ourselves would be silence).
      ...({ selfBrowserSurface: "exclude", systemAudio: "include", surfaceSwitching: "exclude" } as object),
    });
  } catch {
    throw new CaptureError("No tab was shared. Click again, pick the tab your meeting is in, and tick “Also share tab audio”.");
  }
  if (tab.getAudioTracks().length === 0) {
    tab.getTracks().forEach((t) => t.stop());
    throw new CaptureError("That share has no audio. Pick a Chrome tab (not a window or the whole screen) and tick “Also share tab audio” at the bottom of the picker.");
  }

  // The microphone is optional: without it the call is still captured, just not the user's own voice.
  const mic = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);

  const context = new AudioContext();
  const mixed = context.createMediaStreamDestination();
  context.createMediaStreamSource(new MediaStream(tab.getAudioTracks())).connect(mixed);
  if (mic) context.createMediaStreamSource(mic).connect(mixed);

  // "Stop sharing" in the browser's own bar ends the recording cleanly, exactly like pressing Stop here.
  tab.getTracks().forEach((t) => t.addEventListener("ended", onEnded, { once: true }));

  return {
    stream: mixed.stream,
    label: mic ? "meeting tab + microphone" : "meeting tab",
    cleanup: () => {
      tab.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}

const RecordingContext = createContext<Ctx>({ phase: "idle", start: async () => {}, error: null });
export const useRecording = () => useContext(RecordingContext);

const api = async (url: string, body: object) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
};

export function RecordingProvider({ upcoming, children }: { upcoming: Upcoming[]; children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [title, setTitle] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const meetingId = useRef<string | null>(null);
  const startedAt = useRef(0);
  const size = useRef(0);
  const cleanup = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  async function finish(mime: string) {
    cleanup.current();
    const id = meetingId.current!;
    const durationMs = Date.now() - startedAt.current;
    setPhase("saving");
    try {
      const blob = new Blob(chunks.current, { type: mime });
      if (blob.size < 2000) throw new Error("Nothing was recorded.");
      const ext = mime.includes("mp4") ? "m4a" : "webm";
      const stored = await upload(`recordings/${id}.${ext}`, blob, { access: "private" as "public", handleUploadUrl: "/api/blob/upload", contentType: mime.split(";")[0] });
      await api(`/api/meetings/${id}/recording`, { action: "finish", audioUrl: stored.url, durationMs });
      setPhase("idle");
      router.push(`/meetings/${id}`);
      router.refresh();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "The recording could not be saved.";
      await api(`/api/meetings/${id}/recording`, { action: "cancel", reason }).catch(() => {});
      setPhase("idle");
      setError(reason);
      router.refresh();
    } finally {
      meetingId.current = null;
      recorder.current = null;
    }
  }

  const start = useCallback(async (opts?: StartOptions) => {
    if (phase !== "idle") return;
    setError(null);
    setPhase("starting");
    let capture: Awaited<ReturnType<typeof openCapture>>;
    try {
      capture = await openCapture(opts?.mode ?? "mic", () => stop());
    } catch (e) {
      setPhase("idle");
      setError(e instanceof CaptureError ? e.message : "Could not start recording.");
      return;
    }
    const stream = capture.stream;
    cleanup.current = capture.cleanup;
    try {
      // The meeting row exists from the first second, so the capture shows up in the meetings list too.
      const id = opts?.meetingId
        ? (await api(`/api/meetings/${opts.meetingId}/recording`, { action: "start" })).id
        : (await api("/api/meetings", { kind: "record", title: opts?.title })).id;
      meetingId.current = id;
      setTitle(opts?.title ?? (opts?.mode === "tab" ? `Meeting tab · ${capture.label}` : "Instant meeting"));

      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
      chunks.current = [];
      size.current = 0;
      rec.ondataavailable = (ev) => {
        if (!ev.data.size) return;
        chunks.current.push(ev.data);
        size.current += ev.data.size;
        setBytes(size.current);
        if (size.current >= MAX_BYTES - 512 * 1024) rec.stop(); // Whisper's limit: stop and keep what we have
      };
      rec.onstop = () => void finish(rec.mimeType || mime || "audio/webm");
      rec.start(5000);
      recorder.current = rec;
      startedAt.current = Date.now();
      setElapsed(0);
      setBytes(0);
      setPhase("recording");
      router.refresh();
    } catch (e) {
      capture.cleanup();
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Could not start recording.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, router, stop]);

  // Clock, tab title and favicon: the state stays visible when this tab is in the background.
  useEffect(() => {
    if (phase !== "recording") return;
    const tick = setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    const original = document.title;
    // The framework re-inserts its icon link on navigation, so every icon link is repointed on each tick
    // (not just once), and their original targets are put back when recording stops.
    const originals = new Map<HTMLLinkElement, string>();
    const showRecIcon = () => {
      for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (link.getAttribute("href") === "/icon-rec.svg") continue;
        originals.set(link, link.getAttribute("href") ?? "/icon.svg");
        link.setAttribute("href", "/icon-rec.svg");
      }
    };
    showRecIcon();
    const titleTick = setInterval(() => {
      document.title = `● REC ${formatOffset(Date.now() - startedAt.current)} · Meetscribe`;
      showRecIcon();
    }, 1000);
    const warn = (ev: BeforeUnloadEvent) => { ev.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(tick);
      clearInterval(titleTick);
      document.title = original;
      for (const [link, href] of originals) link.setAttribute("href", href);
      window.removeEventListener("beforeunload", warn);
    };
  }, [phase]);

  return (
    <RecordingContext.Provider value={{ phase, start, error }}>
      {children}
      {phase === "idle" && <UpcomingPopup upcoming={upcoming} onJoin={(m) => start({ meetingId: m.id, title: m.title })} />}

      {(phase === "recording" || phase === "saving" || phase === "starting") && (
        <div role="status" aria-live="polite" className="fixed left-1/2 top-1.5 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink py-1 pl-1.5 pr-1 text-white shadow-pop">
          <BrandMark className="size-6" />
          {phase === "recording" ? (
            <>
              <span className="size-2 animate-rec rounded-full bg-rec" aria-hidden />
              <span className="text-sm font-medium">Meetscribe is recording</span>
              <span className="max-w-40 truncate text-xs text-white/60">{title}</span>
              <span className="tabular font-mono text-sm text-white/80">{formatOffset(elapsed)}</span>
              {bytes > WARN_BYTES && <span className="text-xs text-white/70">nearly full</span>}
              <button type="button" onClick={stop} className="flex h-7 items-center gap-1.5 rounded-full bg-rec px-3 text-xs font-semibold transition-opacity hover:opacity-90">
                <Square className="size-3 fill-current" /> Stop
              </button>
            </>
          ) : (
            <span className="flex items-center gap-2 pr-3 text-sm"><Loader2 className="size-3.5 animate-spin" /> {phase === "starting" ? "Starting…" : "Saving your recording…"}</span>
          )}
        </div>
      )}

      {error && phase === "idle" && (
        <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-warn shadow-pop">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      )}
    </RecordingContext.Provider>
  );
}

/** The pre-meeting prompt for a scheduled meeting. Same brand, same recording path as an instant meeting. */
function UpcomingPopup({ upcoming, onJoin }: { upcoming: Upcoming[]; onJoin: (m: Upcoming) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  // Shown from 10 minutes before the start until 30 minutes after it.
  const next = upcoming.find((m) => !dismissed.includes(m.id) && new Date(m.startsAt).getTime() - now < 10 * 60_000 && now - new Date(m.startsAt).getTime() < 30 * 60_000);
  if (!next) return null;
  const minutes = Math.round((new Date(next.startsAt).getTime() - now) / 60_000);
  return (
    <div className="fixed bottom-5 right-5 z-40 w-80 rounded-xl bg-surface p-4 shadow-pop">
      <div className="flex items-start gap-3">
        <BrandMark className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-accent"><CalendarClock className="size-3" /> {minutes > 0 ? `Meeting starting in ${minutes}m` : minutes === 0 ? "Meeting starting now" : `Started ${-minutes}m ago`}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink">{next.title}</p>
        </div>
        <button type="button" onClick={() => setDismissed((d) => [...d, next.id])} aria-label="Dismiss" className="text-ink-4 hover:text-ink"><X className="size-4" /></button>
      </div>
      <Button variant="primary" className="mt-3 w-full" onClick={() => onJoin(next)}><Mic /> Join &amp; capture audio</Button>
      <p className="mt-2 text-center text-2xs text-ink-4">Meetscribe shows a recording indicator the whole time.</p>
    </div>
  );
}

export function StartRecordingButton({ className, size = "sm", mode = "mic", label, variant }: { className?: string; size?: "sm" | "md" | "lg"; mode?: CaptureMode; label?: string; variant?: "primary" | "secondary" }) {
  const { phase, start } = useRecording();
  const Icon = mode === "tab" ? MonitorUp : Mic;
  return (
    <Button variant={variant ?? (mode === "tab" ? "secondary" : "primary")} size={size} className={className} disabled={phase !== "idle"} onClick={() => start({ mode })}>
      <Icon /> {phase === "idle" ? (label ?? (mode === "tab" ? "Record a meeting tab" : "Start instant meeting")) : "Recording…"}
    </Button>
  );
}
