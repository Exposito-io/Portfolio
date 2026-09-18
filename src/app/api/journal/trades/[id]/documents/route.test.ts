import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authorization", () => ({ getApiAuthorizationError: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/journal-documents", () => ({
  createMarkdownDocument: vi.fn(),
  deleteJournalDocument: vi.fn(),
  findJournalPdf: vi.fn(),
  listJournalDocuments: vi.fn(),
  updateMarkdownDocument: vi.fn(),
  uploadPdfDocument: vi.fn(),
  JournalDocumentValidationError: class JournalDocumentValidationError extends Error {},
}));

import {
  GET as listDocuments,
  POST as createDocument,
} from "@/app/api/journal/trades/[id]/documents/route";
import {
  DELETE as deleteDocument,
  PATCH as updateDocument,
} from "@/app/api/journal/trades/[id]/documents/[documentId]/route";
import { GET as getPdfContent } from "@/app/api/journal/trades/[id]/documents/[documentId]/content/route";
import { getApiAuthorizationError } from "@/lib/authorization";
import {
  createMarkdownDocument,
  deleteJournalDocument,
  findJournalPdf,
  listJournalDocuments as listDocumentsService,
  updateMarkdownDocument,
  uploadPdfDocument,
} from "@/lib/journal-documents";
import { getDb } from "@/lib/mongodb";
import type { JournalDocument } from "@/lib/types";

const tradeContext = { params: Promise.resolve({ id: "trade-1" }) };
const documentContext = {
  params: Promise.resolve({ id: "trade-1", documentId: "document-1" }),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
  vi.mocked(getDb).mockResolvedValue({} as never);
});

describe("journal document routes", () => {
  it("rejects unauthenticated requests before reading the database", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(
      new Response(null, { status: 401 }) as never,
    );

    expect(
      (await listDocuments(new Request("http://localhost"), tradeContext)).status,
    ).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("lists documents and returns 404 for a missing journal", async () => {
    vi.mocked(listDocumentsService)
      .mockResolvedValueOnce([markdownDocument()])
      .mockResolvedValueOnce(null);

    const response = await listDocuments(
      new Request("http://localhost"),
      tradeContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      documents: [{ kind: "markdown", title: "Memo" }],
    });

    const missing = await listDocuments(
      new Request("http://localhost"),
      tradeContext,
    );
    expect(missing.status).toBe(404);
  });

  it("creates Markdown from JSON and PDFs from multipart form data", async () => {
    const markdown = markdownDocument();
    const pdf = pdfDocument();
    vi.mocked(createMarkdownDocument).mockResolvedValue(markdown);
    vi.mocked(uploadPdfDocument).mockResolvedValue(pdf);

    const markdownResponse = await createDocument(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "markdown",
          title: "Memo",
          contentMarkdown: "# Thesis",
        }),
      }),
      tradeContext,
    );
    expect(markdownResponse.status).toBe(201);
    expect(createMarkdownDocument).toHaveBeenCalledWith(
      expect.anything(),
      "trade-1",
      { kind: "markdown", title: "Memo", contentMarkdown: "# Thesis" },
    );

    const formData = new FormData();
    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    formData.set("kind", "pdf");
    formData.set("file", file);
    const pdfResponse = await createDocument(
      new Request("http://localhost", { method: "POST", body: formData }),
      tradeContext,
    );
    expect(pdfResponse.status).toBe(201);
    expect(uploadPdfDocument).toHaveBeenCalledWith(
      expect.anything(),
      "trade-1",
      expect.objectContaining({ name: "report.pdf" }),
    );
  });

  it("returns 400 when a multipart request does not include a PDF", async () => {
    const formData = new FormData();
    formData.set("kind", "pdf");
    const response = await createDocument(
      new Request("http://localhost", { method: "POST", body: formData }),
      tradeContext,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PDF file is required." });
    expect(uploadPdfDocument).not.toHaveBeenCalled();
  });

  it("updates and deletes only matching documents", async () => {
    vi.mocked(updateMarkdownDocument).mockResolvedValue(markdownDocument());
    vi.mocked(deleteJournalDocument)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const updateResponse = await updateDocument(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Revised" }),
      }),
      documentContext,
    );
    expect(updateResponse.status).toBe(200);
    expect(updateMarkdownDocument).toHaveBeenCalledWith(
      expect.anything(),
      "trade-1",
      "document-1",
      { title: "Revised" },
    );

    expect(
      (await deleteDocument(new Request("http://localhost"), documentContext))
        .status,
    ).toBe(200);
    expect(
      (await deleteDocument(new Request("http://localhost"), documentContext))
        .status,
    ).toBe(404);
  });

  it("streams PDFs with private inline and attachment headers", async () => {
    vi.mocked(findJournalPdf).mockResolvedValue({
      document: pdfDocument(),
      file: { length: 3 } as never,
      stream: Readable.from(Buffer.from("pdf")) as never,
    });

    const inlineResponse = await getPdfContent(
      new Request("http://localhost/content"),
      documentContext,
    );
    expect(inlineResponse.status).toBe(200);
    expect(inlineResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(inlineResponse.headers.get("content-disposition")).toContain("inline");
    expect(inlineResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await inlineResponse.text()).toBe("pdf");

    vi.mocked(findJournalPdf).mockResolvedValue({
      document: pdfDocument(),
      file: { length: 3 } as never,
      stream: Readable.from(Buffer.from("pdf")) as never,
    });
    const downloadResponse = await getPdfContent(
      new Request("http://localhost/content?download=1"),
      documentContext,
    );
    expect(downloadResponse.headers.get("content-disposition")).toContain(
      "attachment",
    );
  });
});

function markdownDocument(): Extract<JournalDocument, { kind: "markdown" }> {
  return {
    id: "document-1",
    kind: "markdown",
    title: "Memo",
    contentMarkdown: "# Thesis",
    createdAt: "2026-09-18T16:00:00.000Z",
    updatedAt: "2026-09-18T16:00:00.000Z",
  };
}

function pdfDocument(): Extract<JournalDocument, { kind: "pdf" }> {
  return {
    id: "document-1",
    kind: "pdf",
    title: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 3,
    contentUrl:
      "/api/journal/trades/trade-1/documents/document-1/content",
    downloadUrl:
      "/api/journal/trades/trade-1/documents/document-1/content?download=1",
    createdAt: "2026-09-18T16:00:00.000Z",
    updatedAt: "2026-09-18T16:00:00.000Z",
  };
}
