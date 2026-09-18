// Prints a meeting's stored summary and action items with the transcript lines each citation points at,
// and checks that every cited offset is the exact start of a real segment. Run: npx tsx scripts/show-meeting.ts <id>
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { db, schema } = await import("../src/db");
  const { and, asc, eq } = await import("drizzle-orm");
  const { formatOffset } = await import("../src/lib/utils");
  const id = process.argv[2];
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  const segs = await db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, id)).orderBy(asc(schema.transcriptSegments.idx));
  // A meeting has one current summary per template. Show the active template's, or --template=<slug>.
  const slug = process.argv.find((a) => a.startsWith("--template="))?.split("=")[1];
  const templates = await db.select().from(schema.templates);
  const templateId = slug ? templates.find((t) => t.slug === slug)?.id : m.activeTemplateId;
  const [s] = await db.select().from(schema.summaries).where(and(eq(schema.summaries.meetingId, id), eq(schema.summaries.isCurrent, true), eq(schema.summaries.templateId, templateId!)));
  const items = await db.select().from(schema.actionItems).where(eq(schema.actionItems.meetingId, id)).orderBy(asc(schema.actionItems.sortOrder));
  const chunks = await db.select().from(schema.transcriptChunks).where(eq(schema.transcriptChunks.meetingId, id));
  const parts = await db.select().from(schema.participants).where(eq(schema.participants.meetingId, id));
  const byStart = new Map(segs.map((x) => [x.startMs, x]));
  const ties = segs.length - byStart.size;
  let cites = 0, bad = 0;
  const quote = (ms: number) => { cites++; const g = byStart.get(ms); if (!g) { bad++; return `      !! ${ms} ms is NOT a segment start`; } return `      ↳ ${formatOffset(ms)} ${g.speaker}: ${g.text.slice(0, 120)}${g.text.length > 120 ? "…" : ""}`; };

  console.log(`TEMPLATE  ${templates.find((t) => t.id === templateId)?.name} (notes version used: ${s.notesVersionUsed})\nTITLE     ${m.title}\nSTATUS    ${m.status} | ${formatOffset(m.durationMs)} | estimated timestamps: ${m.timestampsEstimated}\nPEOPLE    ${parts.map((p) => p.name).join(", ")}\nSTORED    ${segs.length} segments, ${chunks.length} chunks (${chunks.filter((c) => c.embedding).length} embedded, ${Math.min(...chunks.map((c) => c.text.split(/\s+/).length))}-${Math.max(...chunks.map((c) => c.text.split(/\s+/).length))} words incl. speaker labels)\nMODEL     ${s.model}\n`);
  console.log(`OVERVIEW\n  ${s.content.overview}\n`);
  for (const sec of s.content.sections) {
    console.log(sec.title.toUpperCase() + (sec.bullets.length ? "" : "  (none)"));
    for (const b of sec.bullets) { console.log(`  • ${b.from_notes ? "[FROM NOTES] " : ""}${b.text}`); if (process.argv[3] !== "--brief") b.source_ms.forEach((ms) => console.log(quote(ms))); else b.source_ms.forEach((ms) => quote(ms)); }
    console.log();
  }
  console.log("ACTION ITEMS");
  for (const it of items) { console.log(`  ☐ ${it.text}  [${it.assigneeName ?? "unassigned"}${it.dueDate ? ", due " + it.dueDate : ""}] origin=${it.origin}`); if (it.sourceMs !== null) console.log(quote(it.sourceMs)); }
  console.log(`\nCITATION CHECK  ${cites} citations, ${bad} not matching a real segment start | segments sharing an offset: ${ties}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
