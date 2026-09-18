import type { Metadata } from "next";
import { ArrowRight, FilePenLine, MessageSquareQuote, Radio } from "lucide-react";
import { signInAsDemo } from "@/app/actions";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { icon: FilePenLine, title: "Notes that change the summary", body: "Correct something in the Scratchpad and the regenerated summary uses it." },
  { icon: MessageSquareQuote, title: "Answers you can check", body: "Ask across every meeting. Each claim links to the moment it was said." },
  { icon: Radio, title: "Never records silently", body: "Scheduled or instant, capture always shows a Meetscribe indicator." },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Brand className="text-lg" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">Meeting notes you can correct, question and trust.</h1>

        <ul className="mt-6 space-y-4">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon className="size-3.5" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-sm text-ink-3">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <form action={signInAsDemo} className="mt-8">
          <input type="hidden" name="from" value={from ?? ""} />
          <Button variant="primary" size="lg" className="w-full">
            Continue as demo user <ArrowRight />
          </Button>
        </form>
        <p className="mt-3 text-center text-xs text-ink-4">No signup. You get a seeded workspace to explore.</p>
      </div>
    </main>
  );
}
