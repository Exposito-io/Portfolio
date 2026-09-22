import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import {
  createGroupMarkdownDocument,
  JournalDocumentValidationError,
  listJournalGroupDocuments,
  uploadGroupPdfDocument,
} from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const documents = await listJournalGroupDocuments(await getDb(), id);
    return documents
      ? NextResponse.json({ documents })
      : NextResponse.json({ error: "Journal group not found." }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";
    let document;
    if (contentType.startsWith("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (formData.get("kind") !== "pdf" || !(file instanceof File)) {
        throw new JournalDocumentValidationError("PDF file is required.");
      }
      document = await uploadGroupPdfDocument(await getDb(), id, file);
    } else {
      document = await createGroupMarkdownDocument(await getDb(), id, await request.json());
    }
    return document
      ? NextResponse.json({ document }, { status: 201 })
      : NextResponse.json({ error: "Journal group not found." }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof JournalDocumentValidationError || error instanceof SyntaxError) {
    return NextResponse.json({ error: error instanceof ZodError ? error.issues.map((issue) => issue.message).join(" ") : error.message }, { status: 400 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
}
