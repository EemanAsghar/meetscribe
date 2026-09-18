"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Check, ChevronDown, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import { Timestamp } from "@/components/timestamp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Item = { id: string; text: string; assigneeName: string | null; dueDate: string | null; done: boolean; sourceMs: number | null; origin: "ai" | "manual" };

const dueFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function ActionItems({ meetingId, initial, people, estimated }: { meetingId: string; initial: Item[]; people: string[]; estimated: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState("");
  const [draftAssignee, setDraftAssignee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function call(method: "POST" | "PATCH" | "DELETE", body: object) {
    const res = await fetch(`/api/meetings/${meetingId}/action-items`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  }

  /** Optimistic: the list changes at once and is put back if the server refuses. */
  async function change(id: string, patch: Partial<Item>) {
    const before = items;
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setError(null);
    try {
      await call("PATCH", { id, ...patch });
      router.refresh();
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : "Could not save that change.");
    }
  }

  async function remove(id: string) {
    const before = items;
    setItems((all) => all.filter((i) => i.id !== id));
    setError(null);
    try {
      await call("DELETE", { id });
      router.refresh();
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : "Could not remove that item.");
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || adding) return;
    setAdding(true);
    setError(null);
    try {
      const item = await call("POST", { text: draft, assigneeName: draftAssignee });
      setItems((all) => [...all, item]);
      setDraft("");
      setDraftAssignee(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that item.");
    } finally {
      setAdding(false);
    }
  }

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="mx-auto max-w-3xl px-5 py-4">
      {items.length > 0 && (
        <p className="mb-1 text-xs text-ink-3">
          <span className="tabular font-medium text-ink-2">{done.length}</span> of <span className="tabular">{items.length}</span> done
        </p>
      )}
      <ul className="divide-y divide-line">
        {[...open, ...done].map((item) => (
          <li key={item.id} className="group flex items-start gap-3 py-2.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              aria-label={item.done ? "Mark as not done" : "Mark as done"}
              onClick={() => change(item.id, { done: !item.done })}
              className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors", item.done ? "border-accent bg-accent text-white" : "border-line-strong bg-surface hover:border-accent")}
            >
              {item.done && <Check className="size-3" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <EditableText value={item.text} done={item.done} onSave={(text) => change(item.id, { text })} />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <AssigneeMenu value={item.assigneeName} people={people} onChange={(assigneeName) => change(item.id, { assigneeName })} />
                {item.dueDate && <span className="tabular">Due {dueFmt.format(new Date(`${item.dueDate}T00:00:00Z`))}</span>}
                {item.sourceMs !== null && <Timestamp href={`/meetings/${meetingId}?tab=transcript&t=${item.sourceMs}`} ms={item.sourceMs} estimated={estimated} />}
                {item.origin === "ai" ? (
                  <span className="flex items-center gap-1 text-2xs text-ink-4" title="Found by Meetscribe in the transcript"><Sparkles className="size-2.5" /> from the meeting</span>
                ) : (
                  <span className="text-2xs text-ink-4" title="Added by you. Regenerating never changes it.">added by you</span>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove this action item" title="Remove" onClick={() => remove(item.id)} className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className={cn("flex items-center gap-2", items.length > 0 && "mt-2 border-t border-line pt-3")}>
        <Plus className="size-4 shrink-0 text-ink-4" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Add an action item…"
          aria-label="New action item"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none"
        />
        {draft.trim() && (
          <>
            <AssigneeMenu value={draftAssignee} people={people} onChange={setDraftAssignee} />
            <Button type="submit" size="sm" variant="primary" disabled={adding}>Add</Button>
          </>
        )}
      </form>

      {error && <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-warn"><AlertTriangle className="size-4" /> {error}</p>}
    </div>
  );
}

function EditableText({ value, done, onSave }: { value: string; done: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const commit = () => {
    setEditing(false);
    const next = text.trim();
    if (next && next !== value) onSave(next);
    else setText(value);
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setText(value); setEditing(false); } }}
        aria-label="Edit action item"
        className="-mx-1 w-full rounded-sm border border-accent bg-surface px-1 text-sm text-ink focus:outline-none"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Click to edit" className={cn("-mx-1 block w-full rounded-sm px-1 text-left text-sm text-ink hover:bg-hover", done && "text-ink-4 line-through")}>
      {value}
    </button>
  );
}

function AssigneeMenu({ value, people, onChange }: { value: string | null; people: string[]; onChange: (name: string | null) => void }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button type="button" className={cn("flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium transition-colors hover:bg-hover", value ? "bg-sunken text-ink-2" : "text-ink-4")} aria-label="Change who owns this">
          <UserRound className="size-3" /> {value ?? "Unassigned"} <ChevronDown className="size-3 text-ink-4" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={4} className="z-50 max-h-72 w-52 overflow-y-auto rounded-lg bg-surface p-1 shadow-pop">
          {people.map((name) => (
            <Dropdown.Item key={name} onSelect={() => onChange(name)} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-2 outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink">
              <Check className={cn("size-3.5 text-accent", name !== value && "invisible")} /> {name}
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item onSelect={() => onChange(null)} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-3 outline-none data-[highlighted]:bg-hover">
            <Check className={cn("size-3.5 text-accent", value !== null && "invisible")} /> Unassigned
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
