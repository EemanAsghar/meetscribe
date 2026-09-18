"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn as githubSignIn, signOut as githubSignOut } from "@/auth";
import { DEMO_USER_ID, SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";

export async function signInAsDemo(formData: FormData) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(DEMO_USER_ID), sessionCookieOptions);
  const from = String(formData.get("from") ?? "");
  redirect(safePath(from));
}

/** Only same-site paths, so a sign-in link cannot be used as an open redirect. */
const safePath = (from: string) => (from.startsWith("/") && !from.startsWith("//") ? from : "/meetings");

export async function signInWithGitHub(formData: FormData) {
  await githubSignIn("github", { redirectTo: safePath(String(formData.get("from") ?? "")) });
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  // Ends the GitHub session too, if there is one, and redirects.
  await githubSignOut({ redirectTo: "/login" });
}
