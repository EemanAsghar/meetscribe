import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm border border-line bg-sunken px-1 font-sans text-2xs font-medium text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
