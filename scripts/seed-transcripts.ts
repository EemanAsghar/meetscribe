// Loads fixtures/seed/* as meetings: transcript, chunks and embeddings ONLY. No summary or action item calls,
// because text generation is rationed (20 Gemini requests/day per model). Summaries are generated later from
// the app ("Generate summary") or with --summaries. Idempotent: a meeting with the same title and start time
// is skipped. Never deletes anything. Run: npx tsx scripts/seed-transcripts.ts [--summaries]
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { readFileSync } from "node:fs";

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const { db, schema } = await import("../src/db");
  const { and, eq } = await import("drizzle-orm");
  const { createMeetingFromTranscript, embedChunks, processMeeting } = await import("../src/lib/ingest");
  const manifest: { file: string; title: string; startedAt: string; source: "scheduled" | "instant" | "upload" | "paste" }[] = JSON.parse(readFileSync("fixtures/seed/manifest.json", "utf8"));
  const withSummaries = process.argv.includes("--summaries");

  for (const entry of manifest) {
    const startedAt = new Date(entry.startedAt);
    const [existing] = await db.select({ id: schema.meetings.id }).from(schema.meetings).where(and(eq(schema.meetings.ownerId, DEMO_USER_ID), eq(schema.meetings.title, entry.title), eq(schema.meetings.startedAt, startedAt)));
    if (existing) {
      console.log(`skip   ${entry.title} (already loaded as ${existing.id.slice(0, 8)})`);
      continue;
    }
    const { meeting, segments, chunks } = await createMeetingFromTranscript({ ownerId: DEMO_USER_ID, transcript: readFileSync(`fixtures/seed/${entry.file}`, "utf8"), title: entry.title, startedAt, source: entry.source });
    if (withSummaries) {
      await processMeeting(meeting.id);
    } else {
      const embedded = await embedChunks(meeting.id);
      await db.update(schema.meetings).set({ status: "ready" }).where(eq(schema.meetings.id, meeting.id));
      console.log(`loaded ${entry.title.padEnd(40)} ${meeting.id.slice(0, 8)}  ${segments} segments, ${chunks} chunks, ${embedded} embedded`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
