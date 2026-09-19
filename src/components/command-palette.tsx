"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { CornerDownLeft, MessageSquareText, Plus, Video } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

/** ⌘K from anywhere: type a question and press Enter to ask it, or jump to a meeting. */
export function CommandPalette({ meetings }: { meetings: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };
  const item = "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 data-[selected=true]:bg-hover data-[selected=true]:text-ink";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Ask Meetscribe or jump to a meeting"
      shouldFilter
      overlayClassName="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[18vh] z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-surface shadow-pop"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <MessageSquareText className="size-4 text-accent" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Ask anything about your meetings…" className="h-11 flex-1 bg-transparent text-base text-ink placeholder:text-ink-4 focus:outline-none" />
        <Kbd>esc</Kbd>
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-1.5">
        {query.trim().length >= 2 && (
          // forceMount + a value that always matches: asking is available whatever was typed.
          <Command.Group forceMount>
            <Command.Item forceMount value={`ask ${query}`} onSelect={() => go(`/ask?q=${encodeURIComponent(query.trim())}`)} className={item}>
              <MessageSquareText className="size-3.5 text-accent" />
              <span className="flex-1 truncate">Ask: <span className="font-medium text-ink">{query}</span></span>
              <CornerDownLeft className="size-3.5 text-ink-4" />
            </Command.Item>
          </Command.Group>
        )}
        <Command.Group heading="Meetings" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-4">
          {meetings.map((m) => (
            <Command.Item key={m.id} value={`${m.title} ${m.id}`} onSelect={() => go(`/meetings/${m.id}`)} className={item}>
              <Video className="size-3.5 text-ink-3" /> <span className="truncate">{m.title}</span>
            </Command.Item>
          ))}
          <Command.Item value="new meeting upload paste record" onSelect={() => go("/meetings/new")} className={item}>
            <Plus className="size-3.5 text-ink-3" /> New meeting
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
