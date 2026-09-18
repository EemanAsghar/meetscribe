import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

// Everything needs a session except the landing page (exactly "/"), the login page, public share pages and the health check.
export async function proxy(request: NextRequest) {
  const userId = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (userId) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") login.searchParams.set("from", from);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!$|login|s/|api/health|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|ico|txt)$).*)"],
};
