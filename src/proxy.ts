import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-allowlist";

const AUTH_PATH_PREFIX = "/api/auth";
const SIGN_IN_PATH = "/sign-in";

export default auth((request) => {
  const { nextUrl } = request;
  const isAuthRoute = nextUrl.pathname.startsWith(AUTH_PATH_PREFIX);
  const isSignInPage = nextUrl.pathname === SIGN_IN_PATH;
  const isAuthorized = isAllowedEmail(request.auth?.user?.email);

  if (isAuthRoute) {
    return NextResponse.next();
  }

  if (isSignInPage) {
    return isAuthorized
      ? NextResponse.redirect(new URL("/", nextUrl))
      : NextResponse.next();
  }

  if (isAuthorized) {
    return NextResponse.next();
  }

  if (nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const signInUrl = new URL(SIGN_IN_PATH, nextUrl);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${nextUrl.pathname}${nextUrl.search}`,
  );

  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
