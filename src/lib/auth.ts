import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { githubUserId } from "@/auth";
import { db, schema } from "@/db";
import { SESSION_COOKIE, readSessionToken } from "./session";

/**
 * Who is making this request. A real GitHub sign-in wins; otherwise the demo-workspace cookie. Both resolve to a
 * row in `users`, so everything downstream (ownership checks on every route) is identical for the two.
 */
export async function getCurrentUser() {
  const userId = (await githubUserId()) ?? (await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value));
  if (!userId) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
