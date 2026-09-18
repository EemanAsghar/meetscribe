// Generates (or force-regenerates) the summary and action items of stored meetings, one at a time, and prints
// each result with the transcript lines its citations point at, for review.
// Run: npx tsx scripts/generate-summaries.ts <meetingId|--missing> [...]
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
delete process.env.OPENROUTER_API_KEY; // too slow for transcript-sized prompts (see SPEC.md)
if (process.env.GROQ_ONLY) delete process.env.GEMINI_API_KEY; // when Gemini is out of quota, skip three useless 429s per call

async function main() {
  const { db, schema } = await import("../src/db");
  const { asc, eq, and } = await import("drizzle-orm");
  const { regenerateSummary } = await import("../src/lib/ingest");
  const { formatOffset } = await import("../src/lib/utils");
  const [general] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "general"));

  let ids = process.argv.slice(2);
  if (ids.includes("--missing")) {
    const extra = ids.filter((i) => i !== "--missing");
    const all = await db.select().from(schema.meetings).orderBy(asc(schema.meetings.startedAt));
    const have = new Set((await db.select({ id: schema.summaries.meetingId }).from(schema.summaries)).map((r) => r.id));
    ids = [...all.filter((m) => m.status === "ready" && !have.has(m.id)).map((m) => m.id), ...extra];
  }
  for (const id of ids) {
    const t = Date.now();
    const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
    try {
      const r = await regenerateSummary({ meetingId: id, templateId: m.activeTemplateId ?? general.id, force: true });
      const segs = await db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, id)).orderBy(asc(schema.transcriptSegments.idx));
      const byStart = new Map(segs.map((s) => [s.startMs, s]));
      const [s] = await db.select().from(schema.summaries).where(and(eq(schema.summaries.meetingId, id), eq(schema.summaries.isCurrent, true), eq(schema.summaries.templateId, m.activeTemplateId ?? general.id)));
      const items = await db.select().from(schema.actionItems).where(eq(schema.actionItems.meetingId, id)).orderBy(asc(schema.actionItems.sortOrder));
      let cites = 0, bad = 0;
      console.log(`\n${"=".repeat(100)}\n${m.title}  |  summary by ${s.model}  |  ${Math.round((Date.now() - t) / 1000)} s  |  action items refreshed: ${r.actionItemsRefreshed}\n${"=".repeat(100)}\n${s.content.overview}\n`);
      for (const sec of s.content.sections) {
        console.log(sec.title.toUpperCase() + (sec.bullets.length ? "" : "  (none)"));
        for (const b of sec.bullets) {
          console.log(`  • ${b.from_notes ? "[FROM NOTES] " : ""}${b.text}`);
          for (const ms of b.source_ms) { cites++; const g = byStart.get(ms); if (!g) bad++; console.log(`        ↳ ${formatOffset(ms)} ${g?.speaker}: ${g?.text.slice(0, 105)}`); }
        }
      }
      console.log("ACTION ITEMS" + (items.length ? "" : "  (none)"));
      for (const it of items) console.log(`  ☐ ${it.text}  [${it.assigneeName ?? "unassigned"}${it.dueDate ? ", due " + it.dueDate : ""}]`);
      console.log(`-- ${cites} citations, ${bad} unresolved`);
    } catch (e) { console.log(`\n!! ${m.title}: FAILED ${(e as Error).message.slice(0, 300)}`); }
  }
  process.exit(0);
}
main();
