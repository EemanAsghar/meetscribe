// Real-call check of src/lib/llm.ts: primary path, forced fallback, embeddings.
// Run: npx tsx scripts/verify-llm.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { z } from "zod";
import { embed, generateJSON } from "../src/lib/llm";

const schema = z.object({ items: z.array(z.object({ assignee: z.string().nullable(), task: z.string() })) });
const call = () =>
  generateJSON({
    system: "Extract action items from the text.",
    prompt: "Priya will send the pricing deck by Friday. Marcus owns QA sign-off. Someone should book the room.",
    schema,
  });

async function main() {
  console.log("1. primary path");
  const a = await call();
  console.log("   model:", a.model, "| attempts:", JSON.stringify(a.attempts));
  console.log("   data:", JSON.stringify(a.data));

  console.log("   second call (circuit breaker should skip whatever just failed)");
  const a2 = await call();
  console.log("   model:", a2.model, "| attempts:", JSON.stringify(a2.attempts));

  console.log("2. forced fallback to OpenRouter: every Gemini model name made invalid");
  const real = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-does-not-exist";
  process.env.GEMINI_FALLBACK_MODELS = "gemini-also-missing";
  try {
    const b = await call();
    console.log("   model:", b.model);
    for (const at of b.attempts) console.log("   attempt:", at.model, at.ok ? `ok in ${at.ms} ms` : `FAILED in ${at.ms} ms: ${at.error?.slice(0, 140)}`);
    console.log("   data:", JSON.stringify(b.data));
  } finally {
    process.env.GEMINI_MODEL = real;
    delete process.env.GEMINI_FALLBACK_MODELS;
  }

  console.log("3. embeddings");
  const t = Date.now();
  const [v1, v2, v3] = await embed(["The launch date moved to March 17th.", "We pushed the release to mid March.", "The cafeteria serves soup on Tuesdays."]);
  const dot = (x: number[], y: number[]) => x.reduce((s, xi, i) => s + xi * y[i], 0);
  console.log(`   dims: ${v1.length} | norm: ${Math.sqrt(dot(v1, v1)).toFixed(4)} | ${Date.now() - t} ms`);
  console.log(`   similar pair: ${dot(v1, v2).toFixed(3)} | unrelated pair: ${dot(v1, v3).toFixed(3)}`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
