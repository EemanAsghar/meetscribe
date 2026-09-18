import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

// Everything needs a session except the landing page (exactly "/"), the login page, the Auth.js endpoints,
// public share pages and the health check.
// Either kind of session passes: a GitHub sign-in (Auth.js) or the demo-workspace cookie.
export default auth(async (request) => {
  const signedIn = Boolean((request.auth as { uid?: string } | null)?.uid) || Boolean(await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value));
  if (signedIn) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") login.searchParams.set("from", from);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ["/((?!$|login|s/|api/health|api/auth|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|ico|txt)$).*)"],
};
