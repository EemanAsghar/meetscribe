// Latency probe across Gemini Flash models. Run: npx tsx scripts/probe-gemini.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const models = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"];
const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { assignee: { anyOf: [{ type: "string" }, { type: "null" }] }, task: { type: "string" } }, required: ["assignee", "task"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };
(async () => {
  await Promise.all(models.map(async (model) => {
    const t = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ contents: [{ parts: [{ text: "Extract action items: Priya will send the pricing deck by Friday. Marcus owns QA sign-off." }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: "low" } } }) });
      const d = await res.json();
      console.log(`${model.padEnd(24)} HTTP ${res.status} ${String(Date.now() - t).padStart(6)} ms | served by ${d.modelVersion ?? "-"} | ${d.error ? "ERROR " + d.error.message.slice(0, 120) : "valid JSON: " + Boolean(JSON.parse(d.candidates[0].content.parts[0].text).items)}`);
    } catch (e) { console.log(`${model.padEnd(24)} FAILED ${String(Date.now() - t).padStart(6)} ms | ${(e as Error).message}`); }
  }));
})();
