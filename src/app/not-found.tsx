import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Nothing here"
        action={
          <Button asChild>
            <Link href="/meetings">Back to meetings</Link>
          </Button>
        }
      >
        This page does not exist, or the link to it was switched off.
      </EmptyState>
    </main>
  );
}
