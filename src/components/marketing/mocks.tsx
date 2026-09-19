import { NotebookPen, Square } from "lucide-react";
import { BrandMark } from "@/components/brand";

// Static previews for the landing page. Real markup in the app's own components' styles, not screenshots,
// so they stay sharp at any size and change with the design tokens.

const chip = "tabular mx-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-accent-soft px-1 font-mono text-2xs font-medium text-accent-ink";

export function AskMock() {
  return (
    <div className="rounded-xl bg-surface p-5 text-left shadow-pop">
      <p className="text-sm font-semibold text-ink">How did the launch date change, and why?</p>
      <div className="mt-3 flex gap-2.5">
        <BrandMark className="mt-0.5 size-4 shrink-0" />
        <p className="text-sm leading-relaxed text-ink-2">
          It was set for <strong className="font-semibold text-ink">October 6</strong> at the kickoff<span className={chip}>1</span>, moved to{" "}
          <strong className="font-semibold text-ink">October 20</strong> when offline sync needed a rebuild<span className={chip}>2</span>, then to{" "}
          <strong className="font-semibold text-ink">October 27</strong> to follow the payment certification<span className={chip}>3</span>.
        </p>
      </div>
      <div className="mt-3 rounded-lg border border-line p-2.5 shadow-xs">
        <p className="flex justify-between text-2xs text-ink-3"><span className="font-medium text-ink-2">Engineering Sync · Sep 3</span><span className="font-mono">9:54</span></p>
        <p className="mt-1 border-l-2 border-accent-line pl-2 text-xs leading-relaxed text-ink"><span className="font-semibold">Priya Raman:</span> Launch moves from October sixth to October twentieth because offline sync needs per field merging…</p>
      </div>
      <p className="mt-3 border-t border-line pt-2 text-2xs text-ink-4">Sources · Dispatch Launch Kickoff <span className={chip}>1</span> · Engineering Sync <span className={chip}>2</span> · Launch Readiness <span className={chip}>3</span></p>
    </div>
  );
}

export function NotesMock() {
  return (
    <div className="rounded-xl bg-surface p-5 text-left shadow-pop">
      <p className="text-2xs font-semibold uppercase tracking-wider text-ink-4">Scratchpad</p>
      <p className="mt-1.5 rounded-md border border-line-strong bg-canvas p-2.5 text-sm text-ink">Correction: the selling price target is 30 euros, not 25.</p>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-note/25 bg-note-soft px-2.5 py-1.5 text-xs text-ink-2"><NotebookPen className="size-3.5 text-note" /> Your notes changed since this summary was written. <span className="ml-auto rounded-sm bg-surface px-1.5 py-0.5 font-medium text-ink shadow-xs">Regenerate</span></div>
      <p className="mt-3 text-2xs font-semibold uppercase tracking-wider text-ink-4">Summary</p>
      <p className="mt-1.5 flex gap-2 text-sm text-ink"><span className="mt-2 size-1 shrink-0 rounded-full bg-note" />
        <span>The selling price target is 30 euros. <span className="ml-0.5 inline-flex h-4.5 items-center gap-1 rounded-sm bg-note-soft px-1 align-middle text-2xs font-medium text-note"><NotebookPen className="size-2.5" /> From your notes</span><span className={chip}>8:41</span></span>
      </p>
    </div>
  );
}

export function RecordingMock() {
  return (
    <div className="rounded-xl bg-surface p-5 text-left shadow-pop">
      <div className="flex items-center gap-1.5 rounded-t-md border border-line bg-sunken px-2.5 py-1.5 text-2xs text-ink-3">
        <span className="size-2 rounded-full bg-rec" /> <span className="font-medium text-ink-2">● REC 12:48 · Meetscribe</span><span className="ml-auto">browser tab</span>
      </div>
      <div className="flex justify-center rounded-b-md border border-t-0 border-line bg-canvas px-3 py-6">
        <div className="flex items-center gap-2.5 rounded-full bg-ink py-1 pl-1.5 pr-1 text-canvas">
          <BrandMark className="size-6" />
          <span className="size-2 animate-rec rounded-full bg-rec" />
          <span className="text-sm font-medium">Meetscribe is recording</span>
          <span className="tabular font-mono text-sm text-canvas/80">12:48</span>
          <span className="flex h-7 items-center gap-1.5 rounded-full bg-rec px-3 text-xs font-semibold text-white"><Square className="size-3 fill-current" /> Stop</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-3">On every page, in the tab title and in the favicon. Scheduled or instant, there is no way to record without it.</p>
    </div>
  );
}
