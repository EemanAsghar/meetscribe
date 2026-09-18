// Prints how many free OpenRouter requests are left today. Run: npx tsx scripts/openrouter-budget.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
const { data } = await res.json();
console.log(`OpenRouter free requests today: used ${data.free_model_daily_requests.used} of ${data.free_model_daily_requests.limit}, ${data.free_model_daily_requests.remaining} left`);
