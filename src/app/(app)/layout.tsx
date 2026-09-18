import { and, asc, desc, eq } from "drizzle-orm";
import { signOut } from "@/app/actions";
import { CommandPalette } from "@/components/command-palette";
import { RecordingProvider } from "@/components/recording";
import { MobileBar, Sidebar } from "@/components/sidebar";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const meetings = await db
    .select({ id: schema.meetings.id, title: schema.meetings.title })
    .from(schema.meetings)
    .where(eq(schema.meetings.ownerId, user.id))
    .orderBy(desc(schema.meetings.startedAt))
    .limit(30);
  const upcoming = (
    await db
      .select({ id: schema.meetings.id, title: schema.meetings.title, startsAt: schema.meetings.startedAt })
      .from(schema.meetings)
      .where(and(eq(schema.meetings.ownerId, user.id), eq(schema.meetings.status, "scheduled")))
      .orderBy(asc(schema.meetings.startedAt))
      .limit(5)
  ).map((m) => ({ ...m, startsAt: m.startsAt.toISOString() }));

  return (
    <RecordingProvider upcoming={upcoming}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar user={{ name: user.name, avatarColor: user.avatarColor }} signOut={signOut} upcoming={upcoming} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar />
          {children}
        </div>
        <CommandPalette meetings={meetings} />
      </div>
    </RecordingProvider>
  );
}
