import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { Timestamp } from "@/components/timestamp";
import type { SummaryContent } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The one renderer for a stored summary, used by the app AND the public share page, so the two views cannot
 * drift (SPEC.md section 4: "one summary, two views"). Only the link targets differ.
 */
export function SummaryBody({
  content,
  momentHref,
  estimated,
  notesHref,
}: {
  content: SummaryContent;
  /** Where a timestamp chip goes: the transcript tab in the app, an anchor on the share page. */
  momentHref: (ms: number) => string;
  estimated: boolean;
  /** Set in the app only. The Scratchpad is private, so the share page shows no notes badge and no link to it. */
  notesHref?: string;
}) {
  return (
    <>
      <p className="text-base leading-relaxed text-ink-2">{content.overview}</p>
      {content.sections
        .filter((s) => s.bullets.length > 0)
        .map((section) => (
          <section key={section.key} className="mt-7">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{section.title}</h2>
            <ul className="mt-2 space-y-2.5">
              {section.bullets.map((b, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                  <span className={cn("mt-2 size-1 shrink-0 rounded-full", b.from_notes && notesHref ? "bg-note" : "bg-ink-4")} aria-hidden />
                  <span>
                    {b.text}{" "}
                    <span className="ml-0.5 inline-flex flex-wrap gap-1 align-middle">
                      {b.from_notes && notesHref && (
                        <Link href={notesHref} title="This point comes from your Scratchpad notes" className="inline-flex h-4.5 items-center gap-1 rounded-sm bg-note-soft px-1 text-2xs font-medium text-note transition-colors hover:bg-note/15">
                          <NotebookPen className="size-2.5" /> From your notes
                        </Link>
                      )}
                      {b.source_ms.map((ms) => <Timestamp key={ms} href={momentHref(ms)} ms={ms} estimated={estimated} />)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
