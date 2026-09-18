import type { Metadata } from "next";
import Link from "next/link";
import { FileAudio, FileText, Mic } from "lucide-react";
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
          <div className="mx-auto max-w-md px-5 py-16 text-center">
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><Mic className="size-5" strokeWidth={1.75} /></div>
            <h2 className="text-base font-semibold text-ink">Record a conversation in this browser</h2>
            <p className="mt-1 text-sm text-ink-3">Meetscribe records your microphone. A <span className="font-medium text-ink-2">“Meetscribe is recording”</span> indicator stays on screen the whole time, on every page, until you press Stop. Nothing is ever captured without it.</p>
            <StartRecordingButton size="lg" className="mt-6" />
            <p className="mt-3 text-xs text-ink-4">Up to about 90 minutes. There is no bot that joins Zoom or Meet: this records what your microphone hears.</p>
          </div>
        )}
      </main>
    </>
  );
}
