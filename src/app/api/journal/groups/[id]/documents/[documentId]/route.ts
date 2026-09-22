import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { deleteJournalGroupDocument, updateGroupMarkdownDocument } from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id, documentId } = await context.params;
    const document = await updateGroupMarkdownDocument(await getDb(), id, documentId, await request.json());
    return document ? NextResponse.json({ document }) : NextResponse.json({ error: "Document not found." }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id, documentId } = await context.params;
    const deleted = await deleteJournalGroupDocument(await getDb(), id, documentId);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Document not found." }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: error instanceof ZodError ? error.issues.map((issue) => issue.message).join(" ") : error.message }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
}
