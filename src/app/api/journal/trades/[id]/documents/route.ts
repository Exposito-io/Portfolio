import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import {
  createMarkdownDocument,
  JournalDocumentValidationError,
  listJournalDocuments,
  uploadPdfDocument,
} from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const documents = await listJournalDocuments(await getDb(), id);
    if (!documents) {
      return NextResponse.json({ error: "Journal not found." }, { status: 404 });
    }
    return NextResponse.json({ documents });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";
    const document = contentType.startsWith("multipart/form-data")
      ? await createPdfFromFormData(request, id)
      : await createMarkdownDocument(await getDb(), id, await request.json());

    if (!document) {
      return NextResponse.json({ error: "Journal not found." }, { status: 404 });
    }
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function createPdfFromFormData(request: Request, tradeId: string) {
  const formData = await request.formData();
  const kind = formData.get("kind");
  const file = formData.get("file");
  if (kind !== "pdf" || !(file instanceof File)) {
    throw new JournalDocumentValidationError("PDF file is required.");
  }
  return uploadPdfDocument(await getDb(), tradeId, file);
}

function toErrorResponse(error: unknown) {
  if (
    error instanceof ZodError ||
    error instanceof JournalDocumentValidationError ||
    error instanceof SyntaxError
  ) {
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
