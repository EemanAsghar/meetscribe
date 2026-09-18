import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "New meeting" };

export default function NewMeetingPage() {
  return (
    <>
      <PageHeader title="New meeting" />
      <main className="flex-1 overflow-y-auto">
        <EmptyState icon={Upload} title="Capture is not wired up yet">
          Paste and upload arrive in build step 2, in-browser recording in step 7.
        </EmptyState>
      </main>
    </>
  );
}
