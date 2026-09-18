"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_USER_ID, SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";

export async function signInAsDemo(formData: FormData) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(DEMO_USER_ID), sessionCookieOptions);
  const from = String(formData.get("from") ?? "");
  // Only same-site paths, so the login form cannot be used as an open redirect.
  redirect(from.startsWith("/") && !from.startsWith("//") ? from : "/meetings");
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
