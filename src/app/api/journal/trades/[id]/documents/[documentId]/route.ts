import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import {
  deleteJournalDocument,
  updateMarkdownDocument,
} from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
    documentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id, documentId } = await context.params;
    const document = await updateMarkdownDocument(
      await getDb(),
      id,
      documentId,
      await request.json(),
    );
    if (!document) {
      return NextResponse.json(
        { error: "Journal or Markdown document not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ document });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id, documentId } = await context.params;
    const deleted = await deleteJournalDocument(await getDb(), id, documentId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Journal or document not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    const message =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join(" ")
        : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 500 },
  );
}
