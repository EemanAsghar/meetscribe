import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Real sign-in: GitHub OAuth through Auth.js, with the session in a signed, encrypted cookie (no session table).
// On first sign-in a row is created in our own `users` table, and its id travels in the token as `uid`, which is
// what every ownership check in the app uses. A new account starts with an empty workspace of its own.
//
// The one-click demo workspace (src/lib/session.ts) is kept alongside it on purpose: it is where the seeded
// meetings live, so a reviewer can explore without creating anything.

const AVATAR_COLORS = ["#0F766E", "#7C3AED", "#B45309", "#0369A1", "#BE185D", "#4D7C0F", "#4338CA", "#0E7490"];

async function upsertUser(email: string, name: string) {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return existing.id;
  const color = AVATAR_COLORS[[...email].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const [created] = await db
    .insert(schema.users)
    .values({ email, name, avatarColor: color, isDemo: false })
    .onConflictDoNothing({ target: schema.users.email })
    .returning({ id: schema.users.id });
  if (created) return created.id;
  // Two first requests raced: the other one inserted it.
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return row.id;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async jwt({ token, profile, account }) {
      // Only on the sign-in request itself: `account` is set once, right after GitHub redirects back.
      if (account?.provider === "github" && profile) {
        const login = String((profile as { login?: string }).login ?? "github-user");
        // A GitHub account can hide its email. The no-reply address is stable per account, so it still identifies the user.
        const email = (token.email ?? (profile.email as string | null) ?? `${login}@users.noreply.github.com`).toLowerCase();
        token.uid = await upsertUser(email, String(profile.name ?? login));
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") (session as { uid?: string }).uid = token.uid;
      return session;
    },
  },
});

/** The signed-in GitHub user's id in our users table, or null. */
export async function githubUserId(): Promise<string | null> {
  const session = await auth();
  return (session as { uid?: string } | null)?.uid ?? null;
}
