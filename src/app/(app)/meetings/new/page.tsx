import type { Metadata } from "next";
import { NewMeetingForm } from "@/components/new-meeting-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "New meeting" };

export default function NewMeetingPage() {
  return (
    <>
      <PageHeader title="New meeting" />
      <main className="flex-1 overflow-y-auto">
        <NewMeetingForm />
      </main>
    </>
  );
}
