"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Check, ChevronDown, LayoutTemplate, Loader2, NotebookPen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TemplateOption = { id: string; name: string; description: string; ready: boolean };

/**
 * Template switcher and the "notes changed" banner. Both call the same endpoint; the server decides whether
 * a stored summary can be reused (instant) or a model call is needed.
 */
export function SummaryControls({
  meetingId,
  templates,
  activeTemplateId,
  notesChanged,
  failed,
}: {
  meetingId: string;
  templates: TemplateOption[];
  activeTemplateId: string | null;
  notesChanged: boolean;
  failed?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const active = templates.find((t) => t.id === activeTemplateId) ?? templates[0];
  const working = busy !== null || refreshing;

  async function run(templateId: string, label: string, force = false) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pt-4">
      <div className="flex items-center gap-2">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <Button size="sm" disabled={working} aria-label="Summary template">
              <LayoutTemplate className="text-ink-3" /> {active?.name ?? "Template"} <ChevronDown className="text-ink-4" />
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="start" sideOffset={4} className="z-50 w-72 rounded-lg bg-surface p-1 shadow-pop">
              <Dropdown.Label className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-ink-4">Summarise this meeting as</Dropdown.Label>
              {templates.map((t) => (
                <Dropdown.Item
                  key={t.id}
                  onSelect={() => t.id !== active?.id && run(t.id, `Writing the ${t.name} summary…`)}
                  className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
                >
                  <Check className={cn("mt-0.5 size-3.5 shrink-0 text-accent", t.id !== active?.id && "invisible")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      {t.name}
                      {t.ready && t.id !== active?.id && <span className="rounded-sm bg-sunken px-1 text-2xs font-normal text-ink-3">ready</span>}
                    </span>
                    <span className="block text-xs text-ink-3">{t.description}</span>
                  </span>
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {working && (
          <span className="flex items-center gap-1.5 text-xs text-ink-3" role="status">
            <Loader2 className="size-3.5 animate-spin text-accent" /> {busy ?? "Updating…"}
          </span>
        )}
        {failed && !working && active && (
          <Button size="sm" variant="primary" onClick={() => run(active.id, "Trying again…", true)}>
            <RefreshCw /> Try again
          </Button>
        )}
      </div>

      {notesChanged && !failed && active && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-note/25 bg-note-soft px-3 py-2">
          <NotebookPen className="size-4 shrink-0 text-note" />
          <p className="flex-1 text-sm text-ink-2">
            <span className="font-medium text-ink">Your notes changed since this summary was written.</span> Regenerate to work them in. Where
            they disagree with the transcript, your notes win.
          </p>
          <Button size="sm" variant="secondary" disabled={working} onClick={() => run(active.id, "Rewriting with your notes…")}>
            <RefreshCw className={cn(busy && "animate-spin")} /> Regenerate
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
