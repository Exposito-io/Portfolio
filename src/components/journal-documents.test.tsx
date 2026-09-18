// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalDocuments } from "@/components/journal-documents";
import type { JournalDocument } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JournalDocuments", () => {
  it("creates and edits a Markdown document with explicit saves", async () => {
    const created = markdownDocument({
      id: "document-1",
      title: "Investment memo",
      contentMarkdown: "# Initial thesis",
    });
    const updated = {
      ...created,
      title: "Revised memo",
      contentMarkdown: "# Updated thesis",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(jsonResponse({ document: created }, 201))
      .mockResolvedValueOnce(jsonResponse({ document: updated }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<JournalDocuments tradeId="trade-1" />);
    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New Markdown" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Investment memo");
    fireEvent.change(screen.getByRole("textbox", { name: "Document" }), {
      target: { value: "# Initial thesis" },
    });
    await user.click(screen.getByRole("button", { name: "Create document" }));

    expect(
      await screen.findByRole("heading", { name: "Investment memo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Initial thesis")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Investment memo" }));
    const titleInput = screen.getByRole("textbox", { name: "Title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Revised memo");
    fireEvent.change(screen.getByRole("textbox", { name: "Document" }), {
      target: { value: "# Updated thesis" },
    });
    await user.click(screen.getByRole("button", { name: "Save document" }));

    expect(
      await screen.findByRole("heading", { name: "Revised memo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Updated thesis")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PATCH" });
  });

  it("keeps a Markdown draft open when saving fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Database unavailable." }, 500),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<JournalDocuments tradeId="trade-1" />);
    await screen.findByText("No documents yet.");
    await user.click(screen.getByRole("button", { name: "New Markdown" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Unsaved memo");
    await user.click(screen.getByRole("button", { name: "Create document" }));

    expect(await screen.findByText("Database unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Unsaved memo",
    );
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeInTheDocument();
  });

  it("uploads one PDF and renders inline, open, and download controls", async () => {
    const pdf = pdfDocument();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(jsonResponse({ document: pdf }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<JournalDocuments tradeId="trade-1" />);
    await screen.findByText("No documents yet.");

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(
      input as HTMLInputElement,
      new File(["pdf"], "report.pdf", { type: "application/pdf" }),
    );

    expect(
      await screen.findByTitle("report.pdf PDF preview"),
    ).toHaveAttribute("src", pdf.contentUrl);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      pdf.contentUrl,
    );
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      pdf.downloadUrl,
    );
    const formData = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(formData.get("kind")).toBe("pdf");
    expect((formData.get("file") as File).name).toBe("report.pdf");
  });

  it("keeps the selected document visible when a PDF upload fails", async () => {
    const memo = markdownDocument({
      title: "Selected memo",
      contentMarkdown: "Keep this visible",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [memo] }))
      .mockResolvedValueOnce(jsonResponse({ error: "PDF must be 10 MB or smaller." }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<JournalDocuments tradeId="trade-1" />);
    expect(
      await screen.findByRole("heading", { name: "Selected memo" }),
    ).toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(
      input as HTMLInputElement,
      new File(["pdf"], "large.pdf", { type: "application/pdf" }),
    );

    expect(
      await screen.findByText("PDF must be 10 MB or smaller."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Selected memo" }),
    ).toBeInTheDocument();
  });

  it("selects the next document after deleting the active document", async () => {
    const first = markdownDocument({
      id: "document-1",
      title: "First memo",
      contentMarkdown: "First content",
    });
    const second = markdownDocument({
      id: "document-2",
      title: "Second memo",
      contentMarkdown: "Second content",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [first, second] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<JournalDocuments tradeId="trade-1" />);
    expect(
      await screen.findByRole("heading", { name: "First memo" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete First memo" }));

    expect(
      await screen.findByRole("heading", { name: "Second memo" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("First content")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });
});

function markdownDocument(
  overrides: Partial<Extract<JournalDocument, { kind: "markdown" }>> = {},
): Extract<JournalDocument, { kind: "markdown" }> {
  return {
    id: "markdown-1",
    kind: "markdown",
    title: "Memo",
    contentMarkdown: "# Thesis",
    createdAt: "2026-09-18T16:00:00.000Z",
    updatedAt: "2026-09-18T16:00:00.000Z",
    ...overrides,
  };
}

function pdfDocument(): Extract<JournalDocument, { kind: "pdf" }> {
  return {
    id: "pdf-1",
    kind: "pdf",
    title: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 3,
    contentUrl: "/api/journal/trades/trade-1/documents/pdf-1/content",
    downloadUrl:
      "/api/journal/trades/trade-1/documents/pdf-1/content?download=1",
    createdAt: "2026-09-18T16:00:00.000Z",
    updatedAt: "2026-09-18T16:00:00.000Z",
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
