import { NextResponse } from "next/server";
import { getApiAuthorizationError } from "@/lib/authorization";
import { getJournalNews, JournalNewsHttpError } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";
type RouteContext = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError(); if (authorizationError) return authorizationError;
  try { const { id } = await context.params; const news = await getJournalNews(await getDb(), id, fetch, "journalTradeGroups"); return news ? NextResponse.json({ news }) : NextResponse.json({ error: "Journal group not found." }, { status: 404 }); }
  catch (error) { return error instanceof JournalNewsHttpError ? NextResponse.json({ error: error.message }, { status: error.status }) : NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 }); }
}
