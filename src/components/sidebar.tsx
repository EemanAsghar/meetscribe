"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarClock, LogOut, MessageSquareText, Plus, Video } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/meetings", label: "Meetings", icon: Video },
  { href: "/ask", label: "Ask Meetscribe", icon: MessageSquareText, hint: "⌘K" },
];

const whenFmt = new Intl.DateTimeFormat("en", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function Sidebar({ user, signOut, upcoming }: { user: { name: string; avatarColor: string; isDemo: boolean }; signOut: () => Promise<void>; upcoming: { id: string; title: string; startsAt: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [scheduling, setScheduling] = useState(false);

  // Stand-in for a calendar integration (stubbed, see SPEC.md): puts a meeting two minutes out so the
  // pre-meeting prompt can be seen without waiting for a real calendar event.
  async function scheduleTest() {
    setScheduling(true);
    await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "schedule", title: "Weekly Dispatch Sync", inMinutes: 2 }) }).catch(() => {});
    setScheduling(false);
    router.refresh();
  }
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-sunken/60 md:flex">
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
        {upcoming.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-ink-3"><CalendarClock className="size-3.5" /> Nothing scheduled</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {upcoming.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-xs">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <span className="min-w-0"><span className="block truncate font-medium text-ink-2">{m.title}</span><span className="tabular text-ink-4">{whenFmt.format(new Date(m.startsAt))}</span></span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={scheduleTest} disabled={scheduling} className="mt-2 text-2xs text-ink-4 underline-offset-2 hover:text-accent hover:underline disabled:opacity-50" title="Calendar sync is not built. This adds a meeting two minutes from now so you can see the pre-meeting prompt.">
          {scheduling ? "Adding…" : "+ Simulate a calendar meeting in 2 min"}
        </button>
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
          <p className="text-2xs text-ink-4">{user.isDemo ? "Demo workspace" : "Signed in with GitHub"}</p>
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

/** Below the md breakpoint the sidebar is replaced by this bar, so the app stays usable on a phone. */
export function MobileBar() {
  const pathname = usePathname();
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-sunken/60 px-3 md:hidden">
      <Link href="/meetings" className="mr-auto"><Brand /></Link>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} aria-label={label} className={cn("flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover", active && "bg-hover text-accent")}>
            <Icon className="size-4" />
          </Link>
        );
      })}
      <Link href="/meetings/new" aria-label="New meeting" className="flex size-8 items-center justify-center rounded-md bg-accent text-white"><Plus className="size-4" /></Link>
    </div>
  );
}
