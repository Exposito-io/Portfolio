import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getApiAuthorizationError } from "@/lib/authorization";
import { markJournalNewsItemsRead } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";
type RouteContext = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError(); if (authorizationError) return authorizationError;
  try { const { id } = await context.params; const marked = await markJournalNewsItemsRead(await getDb(), id, await request.json(), "journalTradeGroups"); return marked ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Journal group not found." }, { status: 404 }); }
  catch (error) { if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join(" ") }, { status: 400 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 }); }
}
