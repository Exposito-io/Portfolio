import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-allowlist";

export async function getAllowedSession() {
  const session = await auth();
  return isAllowedEmail(session?.user?.email) ? session : null;
}

export async function requireAllowedSession() {
  const session = await getAllowedSession();
  if (!session) {
    throw new Error("Authentication required.");
  }

  return session;
}

export async function getApiAuthorizationError() {
  return (await getAllowedSession())
    ? null
    : NextResponse.json({ error: "Authentication required." }, { status: 401 });
}
