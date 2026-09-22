import { ObjectId, type ClientSession, type Db, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createTrade } from "@/lib/journal";
import { createGroup, createGroupEntry, createGroupWithNewTrades, listJournalItems } from "@/lib/journal-groups";

const asset = (coin: string) => ({
  kind: "perp" as const,
  label: `${coin} perp`,
  coin,
  chartCoin: coin,
});

describe("journal trade groups", () => {
  it("composes unchanged journal trades and derives group lifecycle dates", async () => {
    const db = fakeDb();
    const first = await createTrade(db, { kind: "trade", title: "CoreWeave", startDate: "2026-09-03", asset: asset("CRWV") });
    const second = await createTrade(db, { kind: "trade", title: "Google", startDate: "2026-09-01", asset: asset("GOOGL") });
    const group = await createGroup(db, {
      kind: "trade",
      title: "Hyperscalers",
      primaryTradeId: first.id,
      memberTradeIds: [first.id, second.id],
    });

    expect(group).toMatchObject({
      title: "Hyperscalers",
      primaryTradeId: first.id,
      startDate: second.startDate,
      endDate: null,
    });
    expect(group.members.map((member) => member.asset.coin)).toEqual(["CRWV", "GOOGL"]);
    const storedFirst = await db.collection("journalTrades").findOne({ _id: new ObjectId(first.id) });
    expect(storedFirst).toMatchObject({ asset: asset("CRWV") });
    expect(storedFirst).not.toHaveProperty("groupId");
    expect(await listJournalItems(db)).toEqual([{ itemType: "group", group }]);
  });

  it("rejects mixed trade and idea membership", async () => {
    const db = fakeDb();
    const trade = await createTrade(db, { kind: "trade", title: "Trade", startDate: "2026-09-01", asset: asset("BTC") });
    const idea = await createTrade(db, { kind: "idea", title: "Idea", startDate: "2026-09-01", asset: asset("ETH") });
    await expect(createGroup(db, {
      kind: "trade",
      title: "Mixed",
      primaryTradeId: trade.id,
      memberTradeIds: [trade.id, idea.id],
    })).rejects.toBeInstanceOf(ZodError);
  });

  it("stores group entry dates as native dates and validates member links", async () => {
    const db = fakeDb();
    const first = await createTrade(db, { title: "One", startDate: "2026-09-01", asset: asset("BTC") });
    const second = await createTrade(db, { title: "Two", startDate: "2026-09-01", asset: asset("ETH") });
    const group = await createGroup(db, { kind: "trade", title: "Pair", primaryTradeId: first.id, memberTradeIds: [first.id, second.id] });
    const updated = await createGroupEntry(db, group.id, {
      date: "2026-09-02T10:30",
      tradeIds: [second.id],
      descriptionMarkdown: "Rebalanced the pair.",
    });
    expect(updated?.entries[0]).toMatchObject({ tradeIds: [second.id], descriptionMarkdown: "Rebalanced the pair." });
    const stored = await db.collection("journalTradeGroups").findOne({ _id: new ObjectId(group.id) });
    if (!stored) throw new Error("Expected stored group.");
    expect(stored.entries[0].date).toBeInstanceOf(Date);
    await expect(createGroupEntry(db, group.id, {
      date: "2026-09-02",
      tradeIds: [new ObjectId().toString()],
      descriptionMarkdown: "Invalid link",
    })).rejects.toBeInstanceOf(ZodError);
  });

  it("creates new and existing members together without changing the trade schema", async () => {
    const db = fakeDb();
    const existing = await createTrade(db, { title: "Existing", startDate: "2026-09-01", asset: asset("CRWV") });
    const group = await createGroupWithNewTrades(
      db,
      {
        kind: "trade",
        title: "Hyperscalers",
        primaryTradeId: "new:google",
        memberTradeIds: [existing.id, "new:google"],
      },
      [{
        clientId: "new:google",
        trade: { title: "Google", startDate: "2026-09-02", asset: asset("GOOGL") },
      }],
      {} as ClientSession,
    );

    expect(group.members.map((member) => member.asset.coin)).toEqual(["CRWV", "GOOGL"]);
    expect(group.primaryTradeId).toBe(group.members[1].id);
    const stored = await db.collection("journalTrades").findOne({ _id: new ObjectId(group.primaryTradeId) });
    expect(stored).not.toHaveProperty("groupId");
  });
});

function fakeDb() {
  const collections = new Map<string, FakeCollection>();
  return {
    databaseName: `journal-groups-${new ObjectId().toString()}`,
    collection(name: string) {
      let value = collections.get(name);
      if (!value) { value = new FakeCollection(); collections.set(name, value); }
      return value;
    },
  } as unknown as Db;
}

class FakeCollection {
  docs: Document[] = [];
  async createIndex() { return "index"; }
  find() {
    const toArray = async () => [...this.docs];
    return { sort: () => ({ toArray }), toArray };
  }
  async findOne(query: Document) {
    if (query._id instanceof ObjectId) {
      return this.docs.find((doc) => doc._id?.toString() === query._id.toString()) ?? null;
    }
    const requested = query["members.tradeId"]?.$in?.map((id: ObjectId) => id.toString()) ?? [];
    return this.docs.find((doc) =>
      (doc.members as Array<{ tradeId: ObjectId }> | undefined)?.some(
        (member) => requested.includes(member.tradeId.toString()),
      ),
    ) ?? null;
  }
  async insertOne(doc: Document) { this.docs.push(doc); return { insertedId: doc._id }; }
  async findOneAndUpdate(query: Document, update: Document) {
    const doc = await this.findOne(query);
    if (!doc) return null;
    if (update.$push?.entries) {
      (doc.entries as Document[]).push(update.$push.entries as Document);
    }
    Object.assign(doc, update.$set ?? {});
    return doc;
  }
}
