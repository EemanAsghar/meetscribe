// Retrieval only: no text-generation model is called. Shows what each question retrieves and how similar it is,
// which is how MIN_SIMILARITY in src/lib/ask/retrieve.ts was chosen. Run: npx tsx scripts/verify-ask-retrieval.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const QUESTIONS: [string, string][] = [
  ["on-topic", "What is the target selling price?"],
  ["on-topic", "Who is the industrial designer?"],
  ["on-topic", "How can people find the remote when it is lost?"],
  ["on-topic, from notes", "When is the finance sign-off due?"],
  ["paraphrase, no shared words", "How much money does the company hope to make?"],
  ["off-topic", "What is the capital of France?"],
  ["off-topic", "How do I reset my router password?"],
  ["off-topic but meeting-like", "What did legal say about the reseller contract?"],
];

async function main() {
  const { retrieve } = await import("../src/lib/ask/retrieve");
  const { formatOffset } = await import("../src/lib/utils");
  const ownerId = "00000000-0000-4000-8000-000000000001";
  for (const [kind, question] of (process.argv[2] ? [["custom", process.argv.slice(2).join(" ")] as [string, string]] : QUESTIONS)) {
    const t = Date.now();
    const r = await retrieve({ ownerId, question });
    console.log(`\n[${kind}] ${question}\n   best similarity ${r.bestSimilarity?.toFixed(3)} | kept ${r.sources.length} | meetings ${new Set(r.sources.map((s) => s.meetingId)).size} | keywordOnly ${r.keywordOnly} | ${Date.now() - t} ms`);
    for (const s of r.sources.slice(0, 3)) console.log(`   ${String(s.n).padStart(2)}. sim ${s.similarity?.toFixed(3) ?? "  -  "} kw#${s.keywordRank ?? "-"} ${s.kind === "note" ? "NOTE " : formatOffset(s.startMs ?? 0).padStart(5)} ${s.meetingTitle.slice(0, 28).padEnd(28)} ${s.text.replace(/\s+/g, " ").slice(0, 90)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
