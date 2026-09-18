"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, LogOut, MessageSquareText, Plus, Video } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/meetings", label: "Meetings", icon: Video },
  { href: "/ask", label: "Ask Meetscribe", icon: MessageSquareText, hint: "⌘K" },
];

export function Sidebar({ user, signOut }: { user: { name: string; avatarColor: string }; signOut: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-sunken/60">
      <div className="flex h-12 items-center px-4">
        <Link href="/meetings" className="rounded-sm">
          <Brand />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <Button asChild variant="primary" className="w-full justify-start">
          <Link href="/meetings/new">
            <Plus /> New meeting
          </Link>
        </Button>
      </div>

      <nav className="flex flex-col gap-px px-2">
        {NAV.map(({ href, label, icon: Icon, hint }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-hover hover:text-ink",
                active && "bg-hover font-medium text-ink",
              )}
            >
              <Icon className={cn("size-3.5", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />
              <span className="flex-1">{label}</span>
              {hint && <Kbd>{hint}</Kbd>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 px-4">
        <p className="text-2xs font-medium uppercase tracking-wider text-ink-4">Upcoming</p>
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-3">
          <CalendarClock className="size-3.5" /> Nothing scheduled
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line p-3">
        <span
          className="flex size-6 items-center justify-center rounded-full text-2xs font-semibold text-white"
          style={{ background: user.avatarColor }}
        >
          {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-medium text-ink">{user.name}</p>
          <p className="text-2xs text-ink-4">Demo workspace</p>
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
            <LogOut />
          </Button>
        </form>
      </div>
    </aside>
  );
}
