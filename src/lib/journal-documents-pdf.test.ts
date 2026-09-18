import { ObjectId, type Db, type Document } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bucketState = vi.hoisted(() => ({
  deletedIds: [] as string[],
  files: new Map<
    string,
    {
      _id: ObjectId;
      filename: string;
      length: number;
      data: Buffer;
    }
  >(),
}));

vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  const { PassThrough, Readable } = await import("node:stream");

  class FakeGridFSBucket {
    openUploadStreamWithId(id: ObjectId, filename: string) {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("finish", () => {
        const data = Buffer.concat(chunks);
        bucketState.files.set(id.toString(), {
          _id: id,
          filename,
          length: data.length,
          data,
        });
      });
      return stream;
    }

    find(query: { _id: ObjectId }) {
      return {
        limit: () => ({
          next: async () => bucketState.files.get(query._id.toString()) ?? null,
        }),
      };
    }

    openDownloadStream(id: ObjectId) {
      const file = bucketState.files.get(id.toString());
      return Readable.from(file?.data ?? Buffer.alloc(0));
    }

    async delete(id: ObjectId) {
      bucketState.deletedIds.push(id.toString());
      bucketState.files.delete(id.toString());
    }
  }

  return { ...actual, GridFSBucket: FakeGridFSBucket };
});

import {
  createMarkdownDocument,
  deleteJournalDocument,
  findJournalPdf,
  JournalDocumentValidationError,
  MAX_PDF_SIZE_BYTES,
  uploadPdfDocument,
} from "@/lib/journal-documents";
import { deleteTrade } from "@/lib/journal";

beforeEach(() => {
  bucketState.deletedIds = [];
  bucketState.files.clear();
});

describe("journal PDF documents", () => {
  it("uploads, finds, and deletes a PDF and its GridFS blob", async () => {
    const { db, collections } = fakeDb();
    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });
    const file = new File(["pdf bytes"], "research.pdf", {
      type: "application/pdf",
    });

    const document = await uploadPdfDocument(db, tradeId.toString(), file);
    expect(document).toMatchObject({
      kind: "pdf",
      title: "research.pdf",
      sizeBytes: file.size,
    });
    expect(bucketState.files.size).toBe(1);
    expect(
      collections.get("journalDocuments")?.docs[0].createdAt,
    ).toBeInstanceOf(Date);

    const found = await findJournalPdf(
      db,
      tradeId.toString(),
      document?.id ?? "",
    );
    expect(found?.file.length).toBe(file.size);
    expect(found?.document).toEqual(document);

    expect(
      await deleteJournalDocument(db, tradeId.toString(), document?.id ?? ""),
    ).toBe(true);
    expect(bucketState.files.size).toBe(0);
    expect(bucketState.deletedIds).toHaveLength(1);
    expect(collections.get("journalDocuments")?.docs).toHaveLength(0);
  });

  it("rejects empty, oversized, and incorrectly typed PDFs", async () => {
    const { db } = fakeDb();
    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });

    await expect(
      uploadPdfDocument(
        db,
        tradeId.toString(),
        new File([], "empty.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toBeInstanceOf(JournalDocumentValidationError);
    await expect(
      uploadPdfDocument(
        db,
        tradeId.toString(),
        new File(["text"], "notes.pdf", { type: "text/plain" }),
      ),
    ).rejects.toBeInstanceOf(JournalDocumentValidationError);
    await expect(
      uploadPdfDocument(
        db,
        tradeId.toString(),
        new File([new Uint8Array(MAX_PDF_SIZE_BYTES + 1)], "large.pdf", {
          type: "application/pdf",
        }),
      ),
    ).rejects.toBeInstanceOf(JournalDocumentValidationError);
    expect(bucketState.files.size).toBe(0);
  });

  it("removes an uploaded blob when its metadata insert fails", async () => {
    const { db, collections } = fakeDb();
    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });
    const documents = db.collection("journalDocuments") as unknown as FakeCollection;
    documents.failNextInsert = true;

    await expect(
      uploadPdfDocument(
        db,
        tradeId.toString(),
        new File(["pdf"], "research.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("Insert failed");

    expect(bucketState.files.size).toBe(0);
    expect(bucketState.deletedIds).toHaveLength(1);
    expect(collections.get("journalDocuments")?.docs).toHaveLength(0);
  });

  it("cascades Markdown metadata and PDF blobs when deleting a journal", async () => {
    const { db, collections } = fakeDb();
    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });
    await createMarkdownDocument(db, tradeId.toString(), {
      kind: "markdown",
      title: "Memo",
      contentMarkdown: "Research",
    });
    await uploadPdfDocument(
      db,
      tradeId.toString(),
      new File(["pdf"], "research.pdf", { type: "application/pdf" }),
    );

    expect(await deleteTrade(db, tradeId.toString())).toBe(true);

    expect(collections.get("journalTrades")?.docs).toHaveLength(0);
    expect(collections.get("journalDocuments")?.docs).toHaveLength(0);
    expect(bucketState.files.size).toBe(0);
    expect(bucketState.deletedIds).toHaveLength(1);
  });
});

function fakeDb() {
  const collections = new Map<string, FakeCollection>();
  const db = {
    collection: (name: string) => {
      let collection = collections.get(name);
      if (!collection) {
        collection = new FakeCollection();
        collections.set(name, collection);
      }
      return collection;
    },
  } as unknown as Db;
  return { db, collections };
}

class FakeCollection {
  docs: Document[] = [];
  failNextInsert = false;

  find(query: Document = {}) {
    const matching = this.docs.filter((document) => matches(document, query));
    return {
      sort: () => ({ toArray: async () => [...matching] }),
      toArray: async () => [...matching],
    };
  }

  async findOne(query: Document) {
    return this.docs.find((document) => matches(document, query)) ?? null;
  }

  async insertOne(document: Document) {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("Insert failed");
    }
    this.docs.push(document);
    return { insertedId: document._id };
  }

  async deleteOne(query: Document) {
    const originalLength = this.docs.length;
    this.docs = this.docs.filter((document) => !matches(document, query));
    return { deletedCount: originalLength - this.docs.length };
  }

  async deleteMany(query: Document) {
    const originalLength = this.docs.length;
    this.docs = this.docs.filter((document) => !matches(document, query));
    return { deletedCount: originalLength - this.docs.length };
  }
}

function matches(document: Document, query: Document) {
  return Object.entries(query).every(([key, value]) => {
    const current = document[key];
    if (current instanceof ObjectId && value instanceof ObjectId) {
      return current.equals(value);
    }
    return current === value;
  });
}
