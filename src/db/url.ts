// Resolves the Postgres connection string. Locally it is DATABASE_URL from .env.local. On Vercel the
// Neon integration picks the variable names, and with a custom prefix they become <PREFIX>_DATABASE_URL
// or <PREFIX>_POSTGRES_URL, so accept those too. Pooled URLs are preferred over unpooled ones.

const KNOWN = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];
const SUFFIXES = ["_DATABASE_URL", "_POSTGRES_URL", "_DATABASE_URL_UNPOOLED", "_POSTGRES_URL_NON_POOLING"];

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): { url: string; from: string } {
  for (const name of KNOWN) {
    if (env[name]) return { url: env[name]!, from: name };
  }
  for (const suffix of SUFFIXES) {
    const name = Object.keys(env).sort().find((k) => k.endsWith(suffix) && env[k]);
    if (name) return { url: env[name]!, from: name };
  }
  // Names only, never values: this message ends up in build logs.
  const seen = Object.keys(env).filter((k) => /DATABASE|POSTGRES|NEON|PG(HOST|USER|DATABASE)/.test(k)).sort();
  throw new Error(
    `No Postgres connection string found. Looked for ${KNOWN.join(", ")} and *${SUFFIXES[0]} / *${SUFFIXES[1]}. ` +
      `Database-looking variables present in this environment: ${seen.length ? seen.join(", ") : "none"}. ` +
      `On Vercel, check Settings > Environment Variables and make sure the variable is enabled for this environment.`,
  );
}
