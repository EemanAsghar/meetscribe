import Link from "next/link";
import { cn, formatOffset } from "@/lib/utils";

/** A clickable offset that opens the transcript at that moment. The ~ marks estimated timestamps. */
export function Timestamp({ meetingId, ms, estimated, className }: { meetingId: string; ms: number; estimated?: boolean; className?: string }) {
  return (
    <Link
      href={`/meetings/${meetingId}?tab=transcript&t=${ms}`}
      className={cn("tabular inline-flex h-4.5 items-center rounded-sm bg-accent-soft px-1 font-mono text-2xs font-medium text-accent-ink transition-colors hover:bg-accent-line", className)}
      title="Open this moment in the transcript"
    >
      {estimated ? "~" : ""}{formatOffset(ms)}
    </Link>
  );
}
