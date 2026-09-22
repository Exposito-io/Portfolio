import {
  ObjectId,
  type ClientSession,
  type Collection,
  type Db,
  type Document,
} from "mongodb";
import { z } from "zod";

import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getZonedJournalDateMs, isValidDateTimeKey } from "@/lib/date";
import { createTrade, listTrades } from "@/lib/journal";
import { deleteJournalDocumentsForGroup } from "@/lib/journal-documents";
import { deleteJournalNewsReadReceipts } from "@/lib/journal-news-cache";
import type {
  JournalItem,
  JournalTrade,
  JournalTradeGroup,
  JournalTradeGroupEntry,
  JournalTradingViewChart,
} from "@/lib/types";

const markdownSchema = z.string().trim().max(12_000).default("");
const tagsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(8)
  .default([])
  .transform(normalizeTags);
const objectIdStringSchema = z
  .string()
  .refine(ObjectId.isValid, "A journal trade identifier is invalid.");

const chartSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80).optional(),
  source: z.enum(["tradingview", "hyperliquid"]).optional(),
  symbol: z.string().trim().min(1).max(240),
});

const groupInputSchema = z.object({
  kind: z.enum(["trade", "idea"]),
  title: z.string().trim().min(1).max(140),
  descriptionMarkdown: markdownSchema,
  metricsMarkdown: markdownSchema,
  primaryTradeId: objectIdStringSchema,
  memberTradeIds: z
    .array(objectIdStringSchema)
    .min(2, "A group needs at least two journal items.")
    .max(12, "A group cannot contain more than 12 journal items.")
    .transform((ids) => [...new Set(ids)]),
  tradingViewCharts: z.array(chartSchema).max(12).default([]),
});

const groupUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  descriptionMarkdown: z.string().trim().max(12_000).optional(),
  metricsMarkdown: z.string().trim().max(12_000).optional(),
  primaryTradeId: objectIdStringSchema.optional(),
  memberTradeIds: z
    .array(objectIdStringSchema)
    .min(2, "A group needs at least two journal items.")
    .max(12, "A group cannot contain more than 12 journal items.")
    .transform((ids) => [...new Set(ids)])
    .optional(),
  tradingViewCharts: z.array(chartSchema).max(12).optional(),
});

const entryInputSchema = z.object({
  date: z.string().trim().refine(isValidDateTimeKey, {
    message: "Entry date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format.",
  }),
  tradeIds: z.array(objectIdStringSchema).max(12).default([]),
  tags: tagsSchema,
  descriptionMarkdown: markdownSchema.refine((value) => value.length > 0, {
    message: "Entry description is required.",
  }),
});

const entryUpdateSchema = entryInputSchema.partial();

type GroupMemberDocument = {
  tradeId: ObjectId;
  order: number;
};

type GroupEntryDocument = {
  _id: ObjectId;
  date: Date;
  tradeIds: ObjectId[];
  tags: string[];
  descriptionMarkdown: string;
  createdAt: Date;
  updatedAt: Date;
};

type GroupNewsFeedDocument = {
  _id: ObjectId;
  kind?: "google" | "rss";
  keywords?: string;
  normalizedKeywords?: string;
  url?: string;
  normalizedUrl?: string;
  createdAt: Date;
};

export type JournalTradeGroupDocument = {
  _id: ObjectId;
  kind: "trade" | "idea";
  title: string;
  descriptionMarkdown: string;
  metricsMarkdown: string;
  primaryTradeId: ObjectId;
  members: GroupMemberDocument[];
  entries: GroupEntryDocument[];
  tradingViewCharts: JournalTradingViewChart[];
  newsFeeds: GroupNewsFeedDocument[];
  createdAt: Date;
  updatedAt: Date;
};

const indexPromises = new Map<string, Promise<string>>();

function collection(db: Db): Collection<JournalTradeGroupDocument> {
  return db.collection<JournalTradeGroupDocument>("journalTradeGroups");
}

async function ensureIndexes(db: Db) {
  let promise = indexPromises.get(db.databaseName);
  if (!promise) {
    promise = collection(db).createIndex(
      { "members.tradeId": 1 },
      { unique: true, name: "unique_group_trade_membership" },
    );
    indexPromises.set(db.databaseName, promise);
  }
  await promise;
}

export async function ensureJournalTradeGroupIndexes(db: Db) {
  await ensureIndexes(db);
}

export async function listJournalItems(db: Db): Promise<JournalItem[]> {
  const [trades, groupDocuments] = await Promise.all([
    listTrades(db),
    collection(db).find().sort({ updatedAt: -1 }).toArray(),
  ]);
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  const groupedIds = new Set<string>();
  const groups = groupDocuments.flatMap((group) => {
    const serialized = serializeGroup(group, tradeById);
    if (!serialized) return [];
    for (const member of serialized.members) groupedIds.add(member.id);
    return [{ itemType: "group" as const, group: serialized }];
  });
  const standalone = trades
    .filter((trade) => !groupedIds.has(trade.id))
    .map((trade) => ({ itemType: "trade" as const, trade }));

  return [...groups, ...standalone].sort(
    (left, right) =>
      new Date(getItemStartDate(right)).getTime() -
        new Date(getItemStartDate(left)).getTime() ||
      new Date(getItemUpdatedAt(right)).getTime() -
        new Date(getItemUpdatedAt(left)).getTime(),
  );
}

export async function listGroups(db: Db) {
  const [trades, groups] = await Promise.all([
    listTrades(db),
    collection(db).find().sort({ updatedAt: -1 }).toArray(),
  ]);
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  return groups.flatMap((group) => {
    const serialized = serializeGroup(group, tradeById);
    return serialized ? [serialized] : [];
  });
}

export async function getGroup(db: Db, id: string) {
  const _id = toObjectId(id);
  if (!_id) return null;
  const [group, trades] = await Promise.all([
    collection(db).findOne({ _id }),
    listTrades(db),
  ]);
  if (!group) return null;
  return serializeGroup(group, new Map(trades.map((trade) => [trade.id, trade])));
}

export async function createGroup(
  db: Db,
  payload: unknown,
  session?: ClientSession,
) {
  await ensureIndexes(db);
  const input = groupInputSchema.parse(payload);
  const trades = await validateMembers(
    db,
    input.memberTradeIds,
    input.kind,
    input.primaryTradeId,
    undefined,
    session,
  );
  const now = new Date();
  const group: JournalTradeGroupDocument = {
    _id: new ObjectId(),
    kind: input.kind,
    title: input.title,
    descriptionMarkdown: input.descriptionMarkdown,
    metricsMarkdown: input.metricsMarkdown,
    primaryTradeId: new ObjectId(input.primaryTradeId),
    members: input.memberTradeIds.map((tradeId, order) => ({
      tradeId: new ObjectId(tradeId),
      order,
    })),
    entries: [],
    tradingViewCharts: normalizeCharts(input.tradingViewCharts),
    newsFeeds: [],
    createdAt: now,
    updatedAt: now,
  };
  await collection(db).insertOne(group, { session });
  return serializeGroup(group, new Map(trades.map((trade) => [trade.id, trade])))!;
}

export async function createGroupWithNewTrades(
  db: Db,
  payload: Record<string, unknown>,
  newTrades: Array<{ clientId: string; trade: Record<string, unknown> }>,
  session: ClientSession,
) {
  const kind = payload.kind;
  if (kind !== "trade" && kind !== "idea") {
    throw new z.ZodError([{ code: "custom", path: ["kind"], message: "A valid journal type is required.", input: kind }]);
  }
  const clientIds = newTrades.map(({ clientId }) => clientId);
  if (new Set(clientIds).size !== clientIds.length) {
    throw new z.ZodError([{ code: "custom", path: ["newTrades"], message: "New journal item identifiers must be unique.", input: clientIds }]);
  }
  const requestedMemberIds = Array.isArray(payload.memberTradeIds)
    ? new Set(payload.memberTradeIds)
    : new Set<unknown>();
  if (clientIds.some((clientId) => !requestedMemberIds.has(clientId))) {
    throw new z.ZodError([{ code: "custom", path: ["newTrades"], message: "Every new journal item must be included in the group.", input: clientIds }]);
  }

  const created: Array<{ clientId: string; trade: JournalTrade }> = [];
  for (const { clientId, trade } of newTrades) {
    created.push({
      clientId,
      trade: await createTrade(db, { ...trade, kind }, session),
    });
  }
  const createdIdByClientId = new Map(
    created.map(({ clientId, trade }) => [clientId, trade.id]),
  );
  const resolveId = (id: unknown) =>
    typeof id === "string" ? createdIdByClientId.get(id) ?? id : id;
  const memberTradeIds = Array.isArray(payload.memberTradeIds)
    ? payload.memberTradeIds.map(resolveId)
    : payload.memberTradeIds;

  return createGroup(
    db,
    {
      ...payload,
      memberTradeIds,
      primaryTradeId: resolveId(payload.primaryTradeId),
    },
    session,
  );
}

export async function updateGroup(db: Db, id: string, payload: unknown) {
  const _id = toObjectId(id);
  if (!_id) return null;
  await ensureIndexes(db);
  const existing = await collection(db).findOne({ _id });
  if (!existing) return null;
  const input = groupUpdateSchema.parse(payload);
  const memberTradeIds = input.memberTradeIds ?? existing.members
    .sort((left, right) => left.order - right.order)
    .map((member) => member.tradeId.toString());
  const primaryTradeId = input.primaryTradeId ?? existing.primaryTradeId.toString();
  if (input.memberTradeIds) {
    const nextMembers = new Set(input.memberTradeIds);
    const referencedRemovedMember = existing.entries.some((entry) =>
      entry.tradeIds.some((tradeId) => !nextMembers.has(tradeId.toString())),
    );
    if (referencedRemovedMember) {
      throw new z.ZodError([{ code: "custom", path: ["memberTradeIds"], message: "Unlink this position from group entries before removing it.", input: input.memberTradeIds }]);
    }
  }
  const trades = await validateMembers(
    db,
    memberTradeIds,
    existing.kind,
    primaryTradeId,
    _id,
  );
  const update: Document = { updatedAt: new Date() };
  if (input.title !== undefined) update.title = input.title;
  if (input.descriptionMarkdown !== undefined) update.descriptionMarkdown = input.descriptionMarkdown;
  if (input.metricsMarkdown !== undefined) update.metricsMarkdown = input.metricsMarkdown;
  if (input.primaryTradeId !== undefined) update.primaryTradeId = new ObjectId(primaryTradeId);
  if (input.memberTradeIds !== undefined) {
    update.members = memberTradeIds.map((tradeId, order) => ({
      tradeId: new ObjectId(tradeId),
      order,
    }));
  }
  if (input.tradingViewCharts !== undefined) {
    update.tradingViewCharts = normalizeCharts(input.tradingViewCharts);
  }
  const result = await collection(db).findOneAndUpdate(
    { _id },
    { $set: update },
    { returnDocument: "after" },
  );
  return result
    ? serializeGroup(result, new Map(trades.map((trade) => [trade.id, trade])))
    : null;
}

export async function deleteGroup(db: Db, id: string) {
  const _id = toObjectId(id);
  if (!_id) return false;
  const existing = await collection(db).findOne({ _id });
  if (!existing) return false;
  await deleteJournalDocumentsForGroup(db, id);
  await deleteJournalNewsReadReceipts(db, _id);
  const result = await collection(db).deleteOne({ _id });
  return result.deletedCount === 1;
}

export async function findGroupForTrade(db: Db, tradeId: string) {
  const memberId = toObjectId(tradeId);
  if (!memberId) return null;
  const group = await collection(db).findOne({ "members.tradeId": memberId });
  return group ? { id: group._id.toString(), title: group.title } : null;
}

export async function addNewGroupMember(
  db: Db,
  groupId: string,
  tradePayload: Record<string, unknown>,
  makePrimary: boolean,
  session: ClientSession,
) {
  const _id = toObjectId(groupId);
  if (!_id) return null;
  const group = await collection(db).findOne({ _id }, { session });
  if (!group) return null;
  if (group.members.length >= 12) {
    throw new z.ZodError([{ code: "custom", path: ["members"], message: "A group cannot contain more than 12 journal items.", input: group.members.length }]);
  }
  const trade = await createTrade(db, { ...tradePayload, kind: group.kind }, session);
  const tradeId = new ObjectId(trade.id);
  await collection(db).updateOne(
    { _id },
    {
      $push: { members: { tradeId, order: group.members.length } },
      $set: {
        ...(makePrimary ? { primaryTradeId: tradeId } : {}),
        updatedAt: new Date(),
      },
    },
    { session },
  );
  return trade;
}

export async function createGroupEntry(
  db: Db,
  groupId: string,
  payload: unknown,
  session?: ClientSession,
) {
  const _id = toObjectId(groupId);
  if (!_id) return null;
  const group = await collection(db).findOne({ _id }, { session });
  if (!group) return null;
  const input = entryInputSchema.parse(payload);
  validateEntryMembers(group, input.tradeIds);
  const now = new Date();
  const entry: GroupEntryDocument = {
    _id: new ObjectId(),
    date: parseInputDate(input.date),
    tradeIds: input.tradeIds.map((id) => new ObjectId(id)),
    tags: input.tags,
    descriptionMarkdown: input.descriptionMarkdown,
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection(db).findOneAndUpdate(
    { _id },
    { $push: { entries: entry }, $set: { updatedAt: now } },
    { returnDocument: "after", session },
  );
  if (!result) return null;
  const trades = await listTrades(db, session);
  return serializeGroup(result, new Map(trades.map((trade) => [trade.id, trade])));
}

export async function updateGroupEntry(
  db: Db,
  groupId: string,
  entryId: string,
  payload: unknown,
) {
  const _id = toObjectId(groupId);
  const entryObjectId = toObjectId(entryId);
  if (!_id || !entryObjectId) return null;
  const group = await collection(db).findOne({ _id });
  if (!group) return null;
  const input = entryUpdateSchema.parse(payload);
  if (input.tradeIds) validateEntryMembers(group, input.tradeIds);
  const set: Document = {
    updatedAt: new Date(),
    "entries.$.updatedAt": new Date(),
  };
  if (input.date !== undefined) set["entries.$.date"] = parseInputDate(input.date);
  if (input.tradeIds !== undefined) {
    set["entries.$.tradeIds"] = input.tradeIds.map((id) => new ObjectId(id));
  }
  if (input.tags !== undefined) set["entries.$.tags"] = input.tags;
  if (input.descriptionMarkdown !== undefined) {
    set["entries.$.descriptionMarkdown"] = input.descriptionMarkdown;
  }
  const result = await collection(db).findOneAndUpdate(
    { _id, "entries._id": entryObjectId },
    { $set: set },
    { returnDocument: "after" },
  );
  return result ? getGroup(db, groupId) : null;
}

export async function deleteGroupEntry(db: Db, groupId: string, entryId: string) {
  const _id = toObjectId(groupId);
  const entryObjectId = toObjectId(entryId);
  if (!_id || !entryObjectId) return null;
  const result = await collection(db).findOneAndUpdate(
    { _id, "entries._id": entryObjectId },
    {
      $pull: { entries: { _id: entryObjectId } },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" },
  );
  return result ? getGroup(db, groupId) : null;
}

function serializeGroup(
  group: JournalTradeGroupDocument,
  tradeById: Map<string, JournalTrade>,
): JournalTradeGroup | null {
  const members = [...group.members]
    .sort((left, right) => left.order - right.order)
    .map((member) => tradeById.get(member.tradeId.toString()))
    .filter((trade): trade is JournalTrade => Boolean(trade));
  if (members.length < 2) return null;
  const startDate = members.reduce(
    (earliest, trade) => trade.startDate < earliest ? trade.startDate : earliest,
    members[0].startDate,
  );
  const endDate = members.some((trade) => !trade.endDate)
    ? null
    : members.reduce(
        (latest, trade) => (trade.endDate! > latest ? trade.endDate! : latest),
        members[0].endDate!,
      );
  return {
    id: group._id.toString(),
    kind: group.kind,
    title: group.title,
    descriptionMarkdown: group.descriptionMarkdown,
    metricsMarkdown: group.metricsMarkdown,
    primaryTradeId: group.primaryTradeId.toString(),
    members,
    entries: [...(group.entries ?? [])]
      .sort((left, right) => right.date.getTime() - left.date.getTime())
      .map(serializeEntry),
    tradingViewCharts: normalizeCharts(group.tradingViewCharts ?? []),
    startDate,
    endDate,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

function serializeEntry(entry: GroupEntryDocument): JournalTradeGroupEntry {
  return {
    id: entry._id.toString(),
    date: entry.date.toISOString(),
    tradeIds: entry.tradeIds.map((id) => id.toString()),
    tags: normalizeTags(entry.tags ?? []),
    descriptionMarkdown: entry.descriptionMarkdown,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

async function validateMembers(
  db: Db,
  memberTradeIds: string[],
  kind: "trade" | "idea",
  primaryTradeId: string,
  currentGroupId?: ObjectId,
  session?: ClientSession,
) {
  if (memberTradeIds.length < 2) {
    throw new z.ZodError([{ code: "custom", path: ["memberTradeIds"], message: "A group needs at least two distinct journal items.", input: memberTradeIds }]);
  }
  if (!memberTradeIds.includes(primaryTradeId)) {
    throw new z.ZodError([{ code: "custom", path: ["primaryTradeId"], message: "The primary journal item must be a group member.", input: primaryTradeId }]);
  }
  const trades = (await listTrades(db, session)).filter((trade) => memberTradeIds.includes(trade.id));
  if (trades.length !== memberTradeIds.length) {
    throw new z.ZodError([{ code: "custom", path: ["memberTradeIds"], message: "One or more journal items do not exist.", input: memberTradeIds }]);
  }
  if (trades.some((trade) => trade.kind !== kind)) {
    throw new z.ZodError([{ code: "custom", path: ["memberTradeIds"], message: `A ${kind} group can only contain ${kind} journal items.`, input: memberTradeIds }]);
  }
  const memberIds = memberTradeIds.map((id) => new ObjectId(id));
  const conflict = await collection(db).findOne(
    {
      "members.tradeId": { $in: memberIds },
      ...(currentGroupId ? { _id: { $ne: currentGroupId } } : {}),
    },
    { session },
  );
  if (conflict) {
    throw new z.ZodError([{ code: "custom", path: ["memberTradeIds"], message: "A journal item can belong to only one group.", input: memberTradeIds }]);
  }
  return trades;
}

function validateEntryMembers(group: JournalTradeGroupDocument, tradeIds: string[]) {
  const members = new Set(group.members.map((member) => member.tradeId.toString()));
  if (tradeIds.some((tradeId) => !members.has(tradeId))) {
    throw new z.ZodError([{ code: "custom", path: ["tradeIds"], message: "Entry links must reference group members.", input: tradeIds }]);
  }
}

function normalizeCharts(charts: JournalTradingViewChart[]) {
  const seen = new Set<string>();
  return charts.filter((chart) => {
    const key = `${chart.source ?? "tradingview"}:${chart.symbol.toLocaleUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseInputDate(value: string) {
  return new Date(getZonedJournalDateMs(value, PORTFOLIO_TIMEZONE, "start"));
}

function toObjectId(id: string) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function getItemStartDate(item: JournalItem) {
  return item.itemType === "group" ? item.group.startDate : item.trade.startDate;
}

function getItemUpdatedAt(item: JournalItem) {
  return item.itemType === "group" ? item.group.updatedAt : item.trade.updatedAt;
}
