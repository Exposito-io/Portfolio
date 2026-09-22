import { NextResponse } from "next/server";
import { getApiAuthorizationError } from "@/lib/authorization";
import { removeJournalNewsFeed } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";
type RouteContext = { params: Promise<{ id: string; feedId: string }> };
export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError(); if (authorizationError) return authorizationError;
  try { const { id, feedId } = await context.params; const removed = await removeJournalNewsFeed(await getDb(), id, feedId, "journalTradeGroups"); return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Journal group or feed not found." }, { status: 404 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 }); }
}
