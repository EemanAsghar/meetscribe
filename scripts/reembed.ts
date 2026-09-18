// Re-embeds every chunk of every meeting (after a change to what is embedded). Embedding calls only,
// UPDATEs only: nothing is inserted or deleted. Run: npx tsx scripts/reembed.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { db, schema } = await import("../src/db");
  const { embedChunks } = await import("../src/lib/ingest");
  for (const m of await db.select({ id: schema.meetings.id, title: schema.meetings.title }).from(schema.meetings)) {
    console.log(`${m.title.padEnd(42)} ${await embedChunks(m.id)} chunks re-embedded`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
