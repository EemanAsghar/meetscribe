import Link from "next/link";
import { CheckSquare, FileText, NotebookPen, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

export const MEETING_TABS = [
  { key: "summary", label: "Summary", icon: FileText },
  { key: "actions", label: "Action items", icon: CheckSquare },
  { key: "transcript", label: "Transcript", icon: ScrollText },
  { key: "scratchpad", label: "Scratchpad", icon: NotebookPen },
] as const;

export type MeetingTab = (typeof MEETING_TABS)[number]["key"];

export function parseTab(value: string | undefined): MeetingTab {
  return MEETING_TABS.some((t) => t.key === value) ? (value as MeetingTab) : "summary";
}

/** Tabs are links, not client state, so ?tab=transcript&t=754000 is a shareable deep link. */
export function MeetingTabs({ meetingId, active, counts }: { meetingId: string; active: MeetingTab; counts?: Partial<Record<MeetingTab, number>> }) {
  return (
    <nav className="flex h-10 shrink-0 items-end gap-1 border-b border-line bg-surface px-4" aria-label="Meeting sections">
      {MEETING_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={`/meetings/${meetingId}?tab=${key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-ink-3 transition-colors hover:text-ink",
              isActive && "border-accent font-medium text-ink",
            )}
          >
            <Icon className={cn("size-3.5", isActive && "text-accent")} />
            {label}
            {counts?.[key] != null && <span className="tabular rounded-sm bg-sunken px-1 text-2xs text-ink-3">{counts[key]}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
