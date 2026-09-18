// Confirms that a transcript too large for Groq's 8,000 tokens/minute is skipped by Groq WITHOUT a call and
// served by Gemini, and that the result is still correct. Run: npx tsx scripts/verify-long-fallthrough.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { readFileSync } from "node:fs";

async function main() {
  const { parseTranscript } = await import("../src/lib/transcript/parse");
  const { generateSummary, generateActionItems } = await import("../src/lib/generate");
  const { estimateTokens } = await import("../src/lib/llm");
  const { formatOffset } = await import("../src/lib/utils");

  // The real 18.5 minute meeting, twice, with the second copy shifted in time: about 37 minutes.
  const once = parseTranscript(readFileSync("fixtures/ami-es2011a.txt", "utf8"));
  const segments = [...once.segments, ...once.segments.map((s) => ({ ...s, idx: s.idx + once.segments.length, startMs: s.startMs + once.durationMs, endMs: s.endMs + once.durationMs }))];
  const text = segments.map((s) => `[${s.idx}] ${s.speaker}: ${s.text}`).join("\n");
  console.log(`transcript: ${segments.length} segments, ${formatOffset(segments.at(-1)!.endMs)}, about ${estimateTokens(text)} tokens by our estimate (Groq allows 8,000 per minute including the reply)\n`);

  const sections = [
    { key: "key_points", title: "Key points", instruction: "The 4 to 7 most important things said, in the order they came up. One sentence each." },
    { key: "decisions", title: "Decisions", instruction: "Only things the group actually agreed on. If nothing was decided, return no bullets." },
    { key: "next_steps", title: "Next steps", instruction: "What happens after this meeting. Name the owner when one was stated." },
  ];
  const t = Date.now();
  const out = await generateSummary({ segments, sections, templateName: "General", order: "speed" });
  console.log(`SUMMARY served by ${out.model} in ${Date.now() - t} ms`);
  for (const a of out.attempts) console.log(`   ${a.ok ? "ok  " : "FAIL"} ${a.model.padEnd(24)} ${String(a.ms).padStart(6)} ms  ${a.error?.slice(0, 110) ?? ""}`);
  console.log(`\n   ${out.title}\n   ${out.content.overview}`);
  for (const sec of out.content.sections) for (const b of sec.bullets) console.log(`   • [${sec.title}] ${b.text}  (${b.source_ms.map(formatOffset).join(", ")})`);
  const starts = new Set(segments.map((s) => s.startMs));
  const cites = out.content.sections.flatMap((s) => s.bullets.flatMap((b) => b.source_ms));
  console.log(`\n   citations: ${cites.length}, unresolved: ${cites.filter((ms) => !starts.has(ms)).length}, in the second half of the transcript: ${cites.filter((ms) => ms >= once.durationMs).length}`);

  const t2 = Date.now();
  const act = await generateActionItems({ segments, participants: once.speakers, meetingDate: new Date(), order: "speed" });
  console.log(`\nACTION ITEMS served by ${act.model} in ${Date.now() - t2} ms`);
  for (const a of act.attempts) console.log(`   ${a.ok ? "ok  " : "FAIL"} ${a.model.padEnd(24)} ${String(a.ms).padStart(6)} ms  ${a.error?.slice(0, 110) ?? ""}`);
  for (const it of act.items) console.log(`   ☐ ${it.text} [${it.assigneeName ?? "unassigned"}] (${formatOffset(it.sourceMs)})`);
}
main().catch((e) => { console.error("FAILED. Attempts:"); for (const a of e.attempts ?? []) console.error(`   ${a.model.padEnd(40)} ${String(a.ms).padStart(6)} ms  ${(a.error ?? "").replace(/\s+/g, " ").replace(/please check your plan.*?rate-limit\. /, "").slice(0, 170)}`); if (!e.attempts) console.error(e.message.slice(0, 400)); process.exit(1); });
