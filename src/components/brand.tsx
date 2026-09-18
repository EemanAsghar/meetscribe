import { cn } from "@/lib/utils";

/** The Meetscribe mark: a speech bubble whose tail is a pen nib. Used anywhere capture must be attributable. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden="true">
      <rect width="24" height="24" rx="6" className="fill-accent" />
      <path d="M7 9.2h10M7 12.4h10M7 15.6h5.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16.6" cy="15.6" r="1.25" fill="#fff" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-ink", className)}>
      <BrandMark />
      Meetscribe
    </span>
  );
}
