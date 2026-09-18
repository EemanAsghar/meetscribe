// Mints a valid Auth.js session cookie for a user in our `users` table, with the server's own AUTH_SECRET.
// Test tool: it lets the sign-in suite exercise a GitHub-authenticated session without GitHub's consent screen.
// Usage: npx tsx scripts/mint-authjs-session.ts <email> <name> [--secure]   -> prints "<cookieName>=<value>"
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { encode } = await import("next-auth/jwt");
  const { db, schema } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const [email, name] = process.argv.slice(2);
  const secure = process.argv.includes("--secure");
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) [user] = await db.insert(schema.users).values({ email, name, isDemo: false }).returning();
  const cookie = `${secure ? "__Secure-" : ""}authjs.session-token`;
  const value = await encode({ token: { uid: user.id, email, name, sub: user.id }, secret: process.env.AUTH_SECRET!, salt: cookie, maxAge: 3600 });
  console.log(`${cookie}=${value}`);
  process.exit(0);
}
main();
