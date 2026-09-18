// Side-by-side quality check: runs the combined ingest call on a stored meeting with ONE provider
// and prints it in the same shape as scripts/show-meeting.ts prints the stored result.
// Run: npx tsx scripts/compare-providers.ts <meetingId> [runs]
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// One provider at a time: with the others unset, a failure fails loudly instead of being rescued.
// ONLY=groq (default) | gemini. For gemini, set GEMINI_MODEL and GEMINI_FALLBACK_MODELS to the model under test.
const only = process.env.ONLY ?? "groq";
if (only !== "gemini") delete process.env.GEMINI_API_KEY;
if (only !== "groq") delete process.env.GROQ_API_KEY;
delete process.env.OPENROUTER_API_KEY;

async function main() {
  const { db, schema } = await import("../src/db");
  const { asc, eq } = await import("drizzle-orm");
  const { generateMeetingNotes } = await import("../src/lib/generate");
  const { formatOffset } = await import("../src/lib/utils");
  const id = process.argv[2];
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
  const segments = await db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, id)).orderBy(asc(schema.transcriptSegments.idx));
  const participants = (await db.select().from(schema.participants).where(eq(schema.participants.meetingId, id))).map((p) => p.name);
  const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, m.activeTemplateId!));
  const byStart = new Map(segments.map((s) => [s.startMs, s]));

  for (let run = 1; run <= Number(process.argv[3] ?? 1); run++) {
    const t = Date.now();
    const out = await generateMeetingNotes({ segments, sections: template.sections, templateName: template.name, participants, meetingDate: m.startedAt, order: "speed" });
    let cites = 0, bad = 0;
    const quote = (ms: number) => { cites++; const g = byStart.get(ms); if (!g) { bad++; return `      !! ${ms}`; } return `      ↳ ${formatOffset(ms)} ${g.speaker}: ${g.text.slice(0, 110)}${g.text.length > 110 ? "…" : ""}`; };
    console.log(`\n================ ${out.model} · run ${run} · ${Date.now() - t} ms · attempts: ${out.attempts.map((a) => `${a.model} ${a.ok ? "ok" : "FAIL " + a.error?.slice(0, 80)}`).join(" | ")}`);
    console.log(`TITLE     ${out.title}\n\nOVERVIEW\n  ${out.content.overview}\n`);
    for (const sec of out.content.sections) {
      console.log(sec.title.toUpperCase() + (sec.bullets.length ? "" : "  (none)"));
      for (const b of sec.bullets) { console.log(`  • ${b.text}`); b.source_ms.forEach((ms) => console.log(quote(ms))); }
      console.log();
    }
    console.log("ACTION ITEMS");
    for (const it of out.actionItems) { console.log(`  ☐ ${it.text}  [${it.assigneeName ?? "unassigned"}${it.dueDate ? ", due " + it.dueDate : ""}]`); console.log(quote(it.sourceMs)); }
    console.log(`\nCHECK  ${out.stats.bullets} bullets, ${out.actionItems.length} action items | ${cites} citations, ${bad} unresolved | model cited ${out.stats.invalidCitations} non-existent lines, ${out.stats.droppedUngrounded} bullets and ${out.droppedActionItems} items dropped as ungrounded`);
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
