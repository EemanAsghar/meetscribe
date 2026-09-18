import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardPaste, FileAudio, FilePenLine, MessageSquareQuote, Mic, Radio, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { AskMock, NotesMock, RecordingMock } from "@/components/marketing/mocks";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Meetscribe · Meeting notes you can correct, question and trust",
  description: "An AI meeting notetaker where your notes change the summary, every answer is cited to the moment it was said, and nothing is ever recorded silently.",
};

const REPO = "https://github.com/EemanAsghar/meetscribe";

/** lucide-react no longer ships brand icons. */
function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className ?? "size-3.5"} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const PILLARS = [
  {
    icon: MessageSquareQuote,
    eyebrow: "Ask across every meeting",
    title: "Answers you can check, not just read",
    body: "Ask a question and Meetscribe searches every meeting and your own notes, by meaning and by keyword. The answer walks your meetings in date order. Every claim carries a citation: hover for the exact quote, click to land on the exact line. If your meetings don't contain the answer, it says so, without guessing.",
    mock: <AskMock />,
  },
  {
    icon: FilePenLine,
    eyebrow: "A scratchpad that matters",
    title: "Correct the AI once, and the summary listens",
    body: "AI summaries get things wrong: a price, a name, who owns what. Write the correction in your Scratchpad and regenerate. Where your notes and the transcript disagree, your notes win, and the summary shows which points came from you, next to the moment the original was said.",
    mock: <NotesMock />,
  },
  {
    icon: Radio,
    eyebrow: "No silent recording",
    title: "You always know when you're being captured",
    body: "A scheduled meeting gets a clear prompt before it starts. An instant one gets exactly the same treatment. While anything is being captured, a Meetscribe indicator stays on screen on every page, in the tab title and in the favicon, until you press Stop.",
    mock: <RecordingMock />,
  },
];

const INPUTS = [
  { icon: Mic, title: "Record in your browser", body: "One click. Transcribed with Whisper when you stop." },
  { icon: FileAudio, title: "Upload a recording", body: "MP3, M4A, WAV or WebM from any call, up to 25 MB." },
  { icon: ClipboardPaste, title: "Paste a transcript", body: "Zoom and Meet captions (.vtt), .srt, Fathom exports, or plain text. Speaker names are kept." },
];

export default async function LandingPage() {
  // Signed-in people go straight to their meetings, as before.
  if (await getCurrentUser()) redirect("/meetings");

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Brand className="text-base" />
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="md" className="hidden sm:inline-flex"><a href={REPO} target="_blank" rel="noreferrer"><Github /> Source</a></Button>
            <Button asChild variant="ghost" size="md"><Link href="/login">Sign in</Link></Button>
            <Button asChild variant="primary" size="md"><Link href="/login">Try the demo <ArrowRight /></Link></Button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[32rem] bg-[radial-gradient(60rem_24rem_at_50%_0%,var(--color-accent-soft),transparent)]" />
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:pt-24">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-accent-line bg-surface px-3 py-1 text-xs font-medium text-accent-ink shadow-xs">
              <span className="size-1.5 rounded-full bg-accent" /> An AI notetaker rebuilt around the three things that bothered me in Fathom
            </p>
            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-ink sm:text-6xl sm:leading-[1.05]">
              Meeting notes you can <span className="text-accent">correct</span>, <span className="text-accent">question</span> and <span className="text-accent">trust</span>.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-ink-3">
              Meetscribe turns any conversation into a summary, action items and something you can ask questions of. Every point links to the moment it was said.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="primary" size="lg"><Link href="/login">Explore the demo workspace <ArrowRight /></Link></Button>
              <Button asChild variant="secondary" size="lg"><a href={REPO} target="_blank" rel="noreferrer"><Github /> See how it was built</a></Button>
            </div>
            <p className="mt-3 text-xs text-ink-4">No signup. Nine meetings already in it.</p>

            <div className="mx-auto mt-14 grid max-w-5xl items-start gap-5 text-left md:grid-cols-2">
              <AskMock />
              <div className="space-y-5 md:mt-10">
                <NotesMock />
              </div>
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl space-y-20 px-5 py-20">
            {PILLARS.map(({ icon: Icon, eyebrow, title, body, mock }, i) => (
              <div key={title} className="grid items-center gap-10 md:grid-cols-2">
                <div className={i % 2 === 1 ? "md:order-2" : undefined}>
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent"><Icon className="size-4" /> {eyebrow}</p>
                  <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-ink">{title}</h2>
                  <p className="mt-4 text-base leading-relaxed text-ink-3">{body}</p>
                </div>
                <div className="rounded-2xl bg-sunken p-5 sm:p-8">{mock}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Inputs */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">Works with what you already have</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-base text-ink-3">
              There is no bot that joins your calls. Bring the conversation in whichever way is easiest, and everything after that is the same.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {INPUTS.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-line bg-surface p-5 shadow-xs">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="size-4.5" /></span>
                  <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-3">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Honesty strip */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent"><ShieldCheck className="size-4" /> Built in the open</p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-ink">Grounded by design, honest about its limits</h2>
            </div>
            <ul className="space-y-3 text-sm leading-relaxed text-ink-2">
              <li><span className="font-semibold text-ink">The model never writes a timestamp.</span> It cites transcript lines; the server maps them to real moments and drops anything that doesn&apos;t resolve.</li>
              <li><span className="font-semibold text-ink">One stored summary, two views.</span> A shared link shows exactly what you see. Your Scratchpad and recordings stay private.</li>
              <li><span className="font-semibold text-ink">Free-tier models, named on every summary.</span> What was measured, what failed and what was cut is in the repo&apos;s spec changelog, along with the full AI conversation that built it.</li>
            </ul>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ask your meetings something.</h2>
            <p className="mt-3 text-base text-ink-3">Try: &ldquo;How did the launch date change, and why?&rdquo;</p>
            <div className="mt-7 flex justify-center"><Button asChild variant="primary" size="lg"><Link href="/login">Open the demo workspace <ArrowRight /></Link></Button></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-ink-3">
          <Brand className="text-sm" />
          <p>A rebuild of Fathom.video for an assignment. Not affiliated with Fathom.</p>
          <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-ink"><Github className="size-3.5" /> EemanAsghar/meetscribe</a>
        </div>
      </footer>
    </div>
  );
}
