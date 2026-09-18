import { ObjectId, type Db, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createMarkdownDocument,
  deleteJournalDocument,
  listJournalDocuments,
  updateMarkdownDocument,
} from "@/lib/journal-documents";

describe("journal documents", () => {
  it("creates, serializes, lists, updates, and deletes Markdown documents", async () => {
    const { db, collections } = fakeDb();
    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });

    const created = await createMarkdownDocument(db, tradeId.toString(), {
      kind: "markdown",
      title: "  Investment memo  ",
      contentMarkdown: "# Thesis",
    });

    expect(created).toMatchObject({
      kind: "markdown",
      title: "Investment memo",
      contentMarkdown: "# Thesis",
    });
    expect(created?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const stored = collections.get("journalDocuments")?.docs[0];
    expect(stored?.tradeId).toBeInstanceOf(ObjectId);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.updatedAt).toBeInstanceOf(Date);

    const listed = await listJournalDocuments(db, tradeId.toString());
    expect(listed).toEqual([created]);

    const updated = await updateMarkdownDocument(
      db,
      tradeId.toString(),
      created?.id ?? "",
      { title: "Revised memo", contentMarkdown: "# Updated thesis" },
    );
    expect(updated).toMatchObject({
      kind: "markdown",
      title: "Revised memo",
      contentMarkdown: "# Updated thesis",
    });

    expect(
      await deleteJournalDocument(db, tradeId.toString(), created?.id ?? ""),
    ).toBe(true);
    expect(await listJournalDocuments(db, tradeId.toString())).toEqual([]);
  });

  it("keeps documents isolated to their owning journal", async () => {
    const { db } = fakeDb();
    const firstTradeId = new ObjectId();
    const secondTradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: firstTradeId });
    await db.collection("journalTrades").insertOne({ _id: secondTradeId });
    const document = await createMarkdownDocument(db, firstTradeId.toString(), {
      kind: "markdown",
      title: "Private memo",
      contentMarkdown: "First journal only",
    });

    expect(await listJournalDocuments(db, secondTradeId.toString())).toEqual([]);
    expect(
      await updateMarkdownDocument(
        db,
        secondTradeId.toString(),
        document?.id ?? "",
        { title: "Wrong owner" },
      ),
    ).toBeNull();
    expect(
      await deleteJournalDocument(
        db,
        secondTradeId.toString(),
        document?.id ?? "",
      ),
    ).toBe(false);
  });

  it("returns null for a missing journal and validates Markdown fields", async () => {
    const { db } = fakeDb();
    const missingTradeId = new ObjectId().toString();
    expect(await listJournalDocuments(db, missingTradeId)).toBeNull();
    expect(
      await createMarkdownDocument(db, missingTradeId, {
        kind: "markdown",
        title: "Memo",
        contentMarkdown: "",
      }),
    ).toBeNull();

    const tradeId = new ObjectId();
    await db.collection("journalTrades").insertOne({ _id: tradeId });
    await expect(
      createMarkdownDocument(db, tradeId.toString(), {
        kind: "markdown",
        title: " ",
        contentMarkdown: "",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createMarkdownDocument(db, tradeId.toString(), {
        kind: "markdown",
        title: "Memo",
        contentMarkdown: "x".repeat(12_001),
      }),
    ).rejects.toBeInstanceOf(ZodError);
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

  find(query: Document = {}) {
    const matching = this.docs.filter((document) => matches(document, query));
    return {
      sort: (sort: Document) => ({
        toArray: async () =>
          [...matching].sort((left, right) =>
            sort.createdAt === -1
              ? asDate(right.createdAt).getTime() - asDate(left.createdAt).getTime()
              : 0,
          ),
      }),
      toArray: async () => [...matching],
    };
  }

  async findOne(query: Document) {
    return this.docs.find((document) => matches(document, query)) ?? null;
  }

  async insertOne(document: Document) {
    this.docs.push(document);
    return { insertedId: document._id };
  }

  async findOneAndUpdate(query: Document, update: Document) {
    const document = this.docs.find((candidate) => matches(candidate, query));
    if (!document) return null;
    Object.assign(document, update.$set);
    return document;
  }

  async deleteOne(query: Document) {
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

function asDate(value: unknown) {
  return value instanceof Date ? value : new Date(0);
}
