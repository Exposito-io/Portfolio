import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-allowlist";
import { isDevelopmentAuthBypassEnabled } from "@/lib/auth-bypass";

export async function getAuthorizationState() {
  const requestHeaders = await headers();
  if (isDevelopmentAuthBypassEnabled(requestHeaders.get("host"))) {
    return { kind: "development" as const, session: null };
  }

  const session = await auth();
  return isAllowedEmail(session?.user?.email)
    ? { kind: "session" as const, session }
    : { kind: "unauthorized" as const, session: null };
}

export async function requireAuthorization() {
  const authorization = await getAuthorizationState();
  if (authorization.kind === "unauthorized") {
    throw new Error("Authentication required.");
  }

  return authorization;
}

export async function getApiAuthorizationError() {
  return (await getAuthorizationState()).kind !== "unauthorized"
    ? null
    : NextResponse.json({ error: "Authentication required." }, { status: 401 });
}
