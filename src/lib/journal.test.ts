import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createEntry,
  createTrade,
  closeTrade,
  deleteEntry,
  deleteTrade,
  getTrade,
  listTrades,
  updateEntry,
  updateTrade,
} from "@/lib/journal";

const asset = {
  kind: "perp" as const,
  label: "ETH perp",
  coin: "ETH",
  chartCoin: "ETH",
};

describe("journal trades", () => {
  it("creates, serializes, updates, and deletes trades and entries", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      title: " ETH setup ",
      descriptionMarkdown: "**Long** pullback",
      startDate: "2026-07-01",
      endDate: "",
      asset,
    });

    expect(trade).toMatchObject({
      kind: "trade",
      direction: null,
      title: "ETH setup",
      endDate: null,
      entries: [],
    });

    const updated = await updateTrade(db, trade.id, {
      endDate: "2026-07-03",
    });

    expect(updated?.endDate).toBe("2026-07-04T03:59:59.999Z");
    expect(updated?.descriptionMarkdown).toBe("**Long** pullback");

    const withChart = await updateTrade(db, trade.id, {
      tradingViewCharts: [
        {
          id: "chart-1",
          name: "Apple",
          source: "tradingview",
          symbol: "NASDAQ:AAPL",
        },
      ],
    });
    expect(withChart?.tradingViewCharts).toEqual([
      {
        id: "chart-1",
        name: "Apple",
        source: "tradingview",
        symbol: "NASDAQ:AAPL",
      },
    ]);
    expect(withChart?.descriptionMarkdown).toBe("**Long** pullback");

    const withEntry = await createEntry(db, trade.id, {
      date: "2026-07-02T14:35",
      tags: ["Post-mortem", "Lessons", "post-MORTEM"],
      descriptionMarkdown: "Added after confirmation",
    });
    const entry = withEntry?.entries[0];

    expect(entry).toMatchObject({
      date: "2026-07-02T18:35:00.000Z",
      tags: ["Post-mortem", "Lessons"],
      descriptionMarkdown: "Added after confirmation",
    });

    const afterEntryUpdate = await updateEntry(db, trade.id, entry?.id ?? "", {
      date: "2026-07-02T15:10",
      tags: ["General"],
      descriptionMarkdown: "_Trailing stop_",
    });

    expect(afterEntryUpdate?.entries[0].descriptionMarkdown).toBe("_Trailing stop_");
    expect(afterEntryUpdate?.entries[0].tags).toEqual(["General"]);
    expect(afterEntryUpdate?.entries[0].date).toBe("2026-07-02T19:10:00.000Z");

    const afterEntryDelete = await deleteEntry(db, trade.id, entry?.id ?? "");
    expect(afterEntryDelete?.entries).toHaveLength(0);

    const untaggedEntry = await createEntry(db, trade.id, {
      date: "2026-07-03",
      descriptionMarkdown: "Routine update",
    });
    expect(untaggedEntry?.entries[0].tags).toEqual([]);

    expect(await listTrades(db)).toHaveLength(1);
    expect(await getTrade(db, "not-an-object-id")).toBeNull();
    expect(await deleteTrade(db, trade.id)).toBe(true);
    expect(await listTrades(db)).toHaveLength(0);
  });

  it("stores long and short direction for trades", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      kind: "trade",
      direction: "short",
      title: "ETH short",
      descriptionMarkdown: "",
      startDate: "2026-07-01",
      asset,
    });

    expect(trade.direction).toBe("short");
    expect((await updateTrade(db, trade.id, { direction: "long" }))?.direction)
      .toBe("long");
    expect((await updateTrade(db, trade.id, { kind: "idea" }))?.direction)
      .toBeNull();
  });

  it("creates an open trade idea with a ticker and no trading PnL semantics", async () => {
    const db = fakeDb();
    const idea = await createTrade(db, {
      kind: "idea",
      title: "ETH watchlist idea",
      descriptionMarkdown: "Wait for confirmation.",
      startDate: "2026-07-01",
      asset,
    });

    expect(idea).toMatchObject({
      kind: "idea",
      endDate: null,
      asset: { coin: "ETH" },
    });

    const closed = await updateTrade(db, idea.id, { endDate: "2026-07-04" });
    expect(closed).toMatchObject({
      kind: "idea",
      endDate: "2026-07-05T03:59:59.999Z",
    });
  });

  it("validates required fields and date ordering", async () => {
    const db = fakeDb();

    await expect(
      createTrade(db, {
        title: "",
        descriptionMarkdown: "",
        startDate: "2026-07-01",
        asset,
      }),
    ).rejects.toBeInstanceOf(ZodError);

    const trade = await createTrade(db, {
      title: "BTC idea",
      descriptionMarkdown: "",
      startDate: "2026-07-10",
      asset,
    });

    await expect(
      updateTrade(db, trade.id, { endDate: "2026-07-09" }),
    ).rejects.toBeInstanceOf(ZodError);

    const timedTrade = await createTrade(db, {
      title: "Timed BTC idea",
      descriptionMarkdown: "",
      startDate: "2026-07-10T14:30",
      asset,
    });
    expect(timedTrade.startDate).toBe("2026-07-10T18:30:00.000Z");
    await expect(
      updateTrade(db, timedTrade.id, { endDate: "2026-07-10T14:29" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("closes a trade and creates its post-mortem entry atomically", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      title: "SOL breakout",
      descriptionMarkdown: "",
      startDate: "2026-07-10",
      asset,
    });

    const closed = await closeTrade(db, trade.id, {
      date: "2026-07-12",
      tags: ["post-mortem"],
      descriptionMarkdown: "What worked and what did not.",
    });

    expect(closed?.endDate).toBe("2026-07-12T04:00:00.000Z");
    expect(closed?.entries[0]).toMatchObject({
      date: "2026-07-12T04:00:00.000Z",
      tags: ["post-mortem"],
      descriptionMarkdown: "What worked and what did not.",
    });

    await expect(
      closeTrade(db, trade.id, {
        date: "2026-07-09",
        tags: ["post-mortem"],
        descriptionMarkdown: "Too early.",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("closes a trade without adding an entry when the note is blank", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      title: "SOL breakout",
      descriptionMarkdown: "",
      startDate: "2026-07-10",
      asset,
    });

    const closed = await closeTrade(db, trade.id, {
      date: "2026-07-12",
      tags: ["post-mortem"],
      descriptionMarkdown: "   ",
    });

    expect(closed?.endDate).toBe("2026-07-12T04:00:00.000Z");
    expect(closed?.entries).toEqual([]);
  });

  it("still requires text for a regular journal entry", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      title: "SOL breakout",
      descriptionMarkdown: "",
      startDate: "2026-07-10",
      asset,
    });

    await expect(
      createEntry(db, trade.id, {
        date: "2026-07-11",
        descriptionMarkdown: "   ",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("sorts entries on the same day by their saved time", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, {
      title: "Timed entries",
      descriptionMarkdown: "",
      startDate: "2026-07-10",
      asset,
    });

    await createEntry(db, trade.id, {
      date: "2026-07-11T09:15",
      descriptionMarkdown: "Morning",
    });
    const result = await createEntry(db, trade.id, {
      date: "2026-07-11T15:45",
      descriptionMarkdown: "Afternoon",
    });

    expect(result?.entries.map((entry) => entry.descriptionMarkdown)).toEqual([
      "Afternoon",
      "Morning",
    ]);
  });
});

function fakeDb() {
  const collection = new FakeCollection();
  return {
    collection: () => collection,
  } as unknown as Db;
}

class FakeCollection {
  docs: Document[] = [];

  find() {
    return {
      sort: () => ({
        toArray: async () => [...this.docs],
      }),
    };
  }

  async findOne(query: Query) {
    return this.docs.find((doc) => idsEqual(doc._id, query._id)) ?? null;
  }

  async insertOne(doc: Document) {
    this.docs.push(doc);
    return { insertedId: doc._id };
  }

  async findOneAndUpdate(query: Query, update: Update) {
    const doc = this.docs.find((candidate) => matches(candidate, query));
    if (!doc) return null;

    applyUpdate(doc, update);
    return doc;
  }

  async deleteOne(query: Query) {
    const initialLength = this.docs.length;
    this.docs = this.docs.filter((doc) => !idsEqual(doc._id, query._id));
    return { deletedCount: initialLength - this.docs.length };
  }
}

type Document = {
  _id: ObjectId;
  entries?: Array<{
    _id: ObjectId;
    date: string;
    tags?: string[];
    descriptionMarkdown: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  [key: string]: unknown;
};

type Query = {
  _id?: ObjectId;
  "entries._id"?: ObjectId;
};

type Update = {
  $set?: Record<string, unknown>;
  $push?: { entries: Document["entries"] extends Array<infer T> ? T : never };
  $pull?: { entries: { _id: ObjectId } };
};

function matches(doc: Document, query: Query) {
  if (query._id && !idsEqual(doc._id, query._id)) return false;
  if (query["entries._id"]) {
    return Boolean(
      doc.entries?.some((entry) => idsEqual(entry._id, query["entries._id"])),
    );
  }
  return true;
}

function applyUpdate(doc: Document, update: Update) {
  for (const [key, value] of Object.entries(update.$set ?? {})) {
    if (key.startsWith("entries.$.")) {
      const entry = doc.entries?.[0];
      if (entry) {
        entry[key.replace("entries.$.", "") as keyof typeof entry] = value as never;
      }
    } else {
      doc[key] = value;
    }
  }

  if (update.$push?.entries) {
    doc.entries = [...(doc.entries ?? []), update.$push.entries];
  }

  if (update.$pull?.entries) {
    doc.entries = (doc.entries ?? []).filter(
      (entry) => !idsEqual(entry._id, update.$pull?.entries._id),
    );
  }
}

function idsEqual(left: ObjectId | undefined, right: ObjectId | undefined) {
  return Boolean(left && right && left.toString() === right.toString());
}
