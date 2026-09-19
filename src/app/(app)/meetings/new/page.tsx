import type { Metadata } from "next";
import Link from "next/link";
import { FileAudio, FileText, Mic, MonitorUp } from "lucide-react";
import { AudioUpload } from "@/components/audio-upload";
import { NewMeetingForm } from "@/components/new-meeting-form";
import { PageHeader } from "@/components/page-header";
import { StartRecordingButton } from "@/components/recording";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "New meeting" };

const MODES = [
  { key: "transcript", label: "Paste a transcript", icon: FileText },
  { key: "audio", label: "Upload a recording", icon: FileAudio },
  { key: "record", label: "Record now", icon: Mic },
] as const;

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const requested = (await searchParams).mode;
  const mode = MODES.find((m) => m.key === requested)?.key ?? "transcript";
  return (
    <>
      <PageHeader title="New meeting" />
      <nav className="flex h-10 shrink-0 items-end gap-1 border-b border-line bg-surface px-4" aria-label="How to add a meeting">
        {MODES.map(({ key, label, icon: Icon }) => (
          <Link key={key} href={`/meetings/new?mode=${key}`} aria-current={mode === key ? "page" : undefined} className={cn("-mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-ink-3 transition-colors hover:text-ink", mode === key && "border-accent font-medium text-ink")}>
            <Icon className={cn("size-3.5", mode === key && "text-accent")} /> {label}
          </Link>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto">
        {mode === "transcript" && <NewMeetingForm />}
        {mode === "audio" && <AudioUpload />}
        {mode === "record" && (
          <div className="mx-auto max-w-3xl px-5 py-10">
            <p className="text-center text-sm text-ink-3">
              Either way, a <span className="font-medium text-ink-2">“Meetscribe is recording”</span> indicator stays on screen on every page until you press Stop. Nothing is ever captured without it.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <section className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-xs">
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><MonitorUp className="size-4.5" /></span>
                <h2 className="mt-4 text-base font-semibold text-ink">Record a meeting tab</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-3">For a Google Meet, Zoom or Teams call running in your browser. Captures <span className="font-medium text-ink-2">everyone on the call</span> plus your microphone.</p>
                <ol className="mt-4 space-y-2 text-sm text-ink-2">
                  {["Join the call in another Chrome tab.", "Click the button below and choose that tab.", "Tick “Also share tab audio” at the bottom of the picker, then Share."].map((step, i) => (
                    <li key={step} className="flex gap-2.5"><span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-2xs font-semibold text-ink-3">{i + 1}</span>{step}</li>
                  ))}
                </ol>
                <StartRecordingButton mode="tab" variant="primary" size="lg" className="mt-5 w-full" />
                <p className="mt-3 text-xs text-ink-4">Chrome or Edge on a computer. Wear headphones, or your microphone will pick the call up a second time. Tell people you are recording.</p>
              </section>

              <section className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-xs">
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Mic className="size-4.5" /></span>
                <h2 className="mt-4 text-base font-semibold text-ink">Record this room</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-3">For an in-person conversation, or a quick voice note. Captures what your microphone hears.</p>
                <div className="flex-1" />
                <StartRecordingButton mode="mic" variant="secondary" size="lg" className="mt-5 w-full" label="Record my microphone" />
                <p className="mt-3 text-xs text-ink-4">Any modern browser. Up to about 90 minutes.</p>
              </section>
            </div>
            <p className="mt-6 text-center text-xs text-ink-4">There is no bot that joins calls on its own: you are in the meeting, and Meetscribe listens through your browser.</p>
          </div>
        )}
      </main>
    </>
  );
}
