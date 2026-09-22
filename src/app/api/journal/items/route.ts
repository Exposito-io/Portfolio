import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { listJournalItems } from "@/lib/journal-groups";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    return NextResponse.json({ items: await listJournalItems(await getDb()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
