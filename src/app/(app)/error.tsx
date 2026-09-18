"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong on this page"
        action={<><Button variant="primary" onClick={reset}><RotateCcw /> Try again</Button><Button asChild><Link href="/meetings">Back to meetings</Link></Button></>}
      >
        Your meetings and notes are safe. This is usually a brief hiccup reaching the database or an AI model.
        {error.digest && <span className="mt-2 block font-mono text-2xs text-ink-4">Reference: {error.digest}</span>}
      </EmptyState>
    </main>
  );
}
