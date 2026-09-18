import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, FilePenLine, MessageSquareQuote, NotebookPen, Radio } from "lucide-react";
import { signInAsDemo } from "@/app/actions";
import { Brand, BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { icon: FilePenLine, title: "Notes that change the summary", body: "Correct something in the Scratchpad and the regenerated summary uses it." },
  { icon: MessageSquareQuote, title: "Answers you can check", body: "Ask across every meeting. Each claim links to the moment it was said." },
  { icon: Radio, title: "Never records silently", body: "Scheduled or instant, capture always shows a Meetscribe indicator." },
];

const chip = "tabular mx-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-accent-soft px-1 font-mono text-2xs font-medium text-accent-ink";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  // Already signed in: the login page is not somewhere you should land.
  if (await getCurrentUser()) redirect(from?.startsWith("/") && !from.startsWith("//") ? from : "/meetings");

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Brand className="text-lg" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">Meeting notes you can correct, question and trust.</h1>
          <ul className="mt-6 space-y-4">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Icon className="size-3.5" /></span>
                <div>
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="text-sm text-ink-3">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <form action={signInAsDemo} className="mt-8">
            <input type="hidden" name="from" value={from ?? ""} />
            <Button variant="primary" size="lg" className="w-full">Continue as demo user <ArrowRight /></Button>
          </form>
          <p className="mt-3 text-center text-xs text-ink-4">No signup. You get a seeded workspace to explore.</p>
        </div>
      </div>

      {/* A static preview of the two things this product does differently. Real markup, not a screenshot. */}
      <div className="hidden items-center justify-center border-l border-line bg-sunken/60 p-10 lg:flex" aria-hidden>
        <div className="w-full max-w-md space-y-4">
          <div className="rounded-xl bg-surface p-5 shadow-sm">
            <p className="text-sm font-semibold text-ink">How did the launch date change, and why?</p>
            <div className="mt-3 flex gap-2.5">
              <BrandMark className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm leading-relaxed text-ink-2">
                It was set for <strong className="font-semibold text-ink">October 6</strong> at the kickoff<span className={chip}>1</span>, moved to <strong className="font-semibold text-ink">October 20</strong> when offline sync needed a rebuild<span className={chip}>2</span>, then to <strong className="font-semibold text-ink">October 27</strong> to follow the payment certification<span className={chip}>3</span>.
              </p>
            </div>
            <div className="mt-3 rounded-lg border border-line p-2.5 shadow-xs">
              <p className="flex justify-between text-2xs text-ink-3"><span className="font-medium text-ink-2">Engineering Sync</span><span className="font-mono">9:54</span></p>
              <p className="mt-1 border-l-2 border-accent-line pl-2 text-xs leading-relaxed text-ink"><span className="font-semibold">Priya Raman:</span> Launch moves from October sixth to October twentieth because offline sync needs per field merging…</p>
            </div>
          </div>
          <div className="rounded-xl bg-surface p-5 shadow-sm">
            <div className="flex items-center gap-2 rounded-md border border-note/25 bg-note-soft px-2.5 py-1.5 text-xs text-ink-2"><NotebookPen className="size-3.5 text-note" /> Your notes changed since this summary was written.</div>
            <p className="mt-3 flex gap-2 text-sm text-ink"><span className="mt-2 size-1 shrink-0 rounded-full bg-note" />
              <span>The selling price target is 30 euros. <span className="ml-0.5 inline-flex h-4.5 items-center gap-1 rounded-sm bg-note-soft px-1 align-middle text-2xs font-medium text-note"><NotebookPen className="size-2.5" /> From your notes</span><span className={chip}>8:41</span></span>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
