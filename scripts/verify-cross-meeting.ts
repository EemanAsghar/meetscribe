// Retrieval-only check of cross-meeting behaviour: which meetings a question draws from, in what order,
// and whether the per-meeting cap holds. No text model is called. Run: npx tsx scripts/verify-cross-meeting.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const QUESTIONS = [
  "How did the launch date change, and why?",
  "How did the Starter price change?",
  "What does Harbor Logistics need from us?",
  "What happened to bulk import?",
  "What has been said about price in my meetings?",
];

async function main() {
  const { retrieve, PER_MEETING } = await import("../src/lib/ask/retrieve");
  for (const question of QUESTIONS) {
    const r = await retrieve({ ownerId: "00000000-0000-4000-8000-000000000001", question });
    const per = new Map<string, number>();
    for (const s of r.sources) per.set(s.meetingTitle, (per.get(s.meetingTitle) ?? 0) + 1);
    const max = Math.max(...per.values());
    console.log(`\n${question}\n   ${r.sources.length} excerpts from ${per.size} meetings | most from one meeting: ${max} (cap ${PER_MEETING}) ${max > PER_MEETING ? "!! CAP BROKEN" : "ok"} | best similarity ${r.bestSimilarity?.toFixed(3)}`);
    for (const [title, n] of [...per.entries()]) console.log(`      ${n} × ${title}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
