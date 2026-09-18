import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Ask Meetscribe" };

export default function AskPage() {
  return (
    <>
      <PageHeader title="Ask Meetscribe" />
      <main className="flex-1 overflow-y-auto">
        <EmptyState icon={MessageSquareText} title="Ask across every meeting">
          Cited answers with jump-to-timestamp links arrive in build step 4.
        </EmptyState>
      </main>
    </>
  );
}
