import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { getApiAuthorizationError } from "@/lib/authorization";
import { findJournalGroupPdf } from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id, documentId } = await context.params;
    const pdf = await findJournalGroupPdf(await getDb(), id, documentId);
    if (!pdf || pdf.document.kind !== "pdf") return NextResponse.json({ error: "PDF not found." }, { status: 404 });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    const fallback = pdf.document.title.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(pdf.document.title).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(Readable.toWeb(pdf.stream) as ReadableStream, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(pdf.file.length),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
  }
}
