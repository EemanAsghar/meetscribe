import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODELS",
  "BLOB_READ_WRITE_TOKEN",
] as const;

/** Presence only. Values are never returned. */
function envPresence() {
  return Object.fromEntries(REQUIRED_ENV.map((name) => [name, Boolean(process.env[name])]));
}

// Proves the deployed instance can reach Neon and that migrations ran. No secrets, safe to leave public.
export async function GET() {
  const started = Date.now();
  try {
    const result = await db.execute(sql`
      select
        (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
        (select count(*)::int from information_schema.tables where table_schema = 'public') as tables,
        (select count(*)::int from templates) as templates,
        (select extversion from pg_extension where extname = 'vector') as pgvector
    `);
    return Response.json({
      ok: true,
      db: result.rows[0],
      db_ms: Date.now() - started,
      region: process.env.VERCEL_REGION ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      env: envPresence(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown", env: envPresence() },
      { status: 503 },
    );
  }
}
