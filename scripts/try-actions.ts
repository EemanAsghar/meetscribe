// Runs action item extraction on a stored meeting, several times per model, to check it is stable.
// Run: npx tsx scripts/try-actions.ts <meetingId> [runsPerModel]
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { db, schema } = await import("../src/db");
  const { asc, eq } = await import("drizzle-orm");
  const { generateActionItems } = await import("../src/lib/generate");
  const { formatOffset } = await import("../src/lib/utils");
  const id = process.argv[2];
  const runs = Number(process.argv[3] ?? 2);
  const segments = await db.select().from(schema.transcriptSegments).where(eq(schema.transcriptSegments.meetingId, id)).orderBy(asc(schema.transcriptSegments.idx));
  const participants = (await db.select().from(schema.participants).where(eq(schema.participants.meetingId, id))).map((p) => p.name);
  const byStart = new Map(segments.map((s) => [s.startMs, s]));
  for (const model of (process.env.TRY_MODELS ?? "gemini-3.6-flash,gemini-3.5-flash").split(",")) {
    process.env.GEMINI_MODEL = model;
    process.env.GEMINI_FALLBACK_MODELS = model;
    for (let r = 1; r <= runs; r++) {
      const t = Date.now();
      try {
        const out = await generateActionItems({ segments, participants, meetingDate: new Date() });
        console.log(`\n${model} run ${r}: ${out.items.length} items, ${out.dropped} dropped, served by ${out.model}, ${Date.now() - t} ms`);
        for (const it of out.items) {
          const g = byStart.get(it.sourceMs)!;
          console.log(`  ☐ ${it.text} [${it.assigneeName ?? "unassigned"}]\n      ↳ ${formatOffset(it.sourceMs)} ${g.speaker}: ${g.text.slice(0, 110)}`);
        }
      } catch (e) { console.log(`\n${model} run ${r}: FAILED ${(e as Error).message.slice(0, 160)}`); }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
