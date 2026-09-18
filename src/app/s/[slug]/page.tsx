import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db";
import { formatDuration } from "@/lib/utils";

// Public and unauthenticated: excluded from the proxy matcher, and only meetings with
// share_enabled are reachable. It will read the same summaries row as the app (SPEC.md section 4).

async function loadShared(slug: string) {
  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.shareSlug, slug), eq(schema.meetings.shareEnabled, true)))
    .limit(1);
  return meeting ?? null;
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meeting = await loadShared((await params).slug);
  return { title: meeting?.title ?? "Shared meeting", robots: { index: false } };
}

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "long" });

export default async function SharePage({ params }: Props) {
  const meeting = await loadShared((await params).slug);
  if (!meeting) notFound();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-5">
          <Link href="/">
            <Brand />
          </Link>
          <span className="text-xs text-ink-4">Shared meeting notes</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{meeting.title}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {dateFmt.format(meeting.startedAt)} · <span className="tabular">{formatDuration(meeting.durationMs)}</span>
        </p>
        <div className="mt-8 rounded-lg border border-line bg-surface">
          <EmptyState icon={FileText} title="No summary yet">
            The shared summary arrives in build step 6.
          </EmptyState>
        </div>
      </main>
    </div>
  );
}
