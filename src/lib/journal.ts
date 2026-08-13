import { ObjectId, type Collection, type Db, type Document } from "mongodb";
import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import type {
  JournalEntry,
  JournalTrade,
  JournalTradeAsset,
  JournalTradingViewChart,
} from "@/lib/types";

const markdownSchema = z.string().trim().max(12_000).default("");
const entryTagsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(8)
  .default([])
  .transform(normalizeTags);

const assetSchema = z.object({
  kind: z.enum(["perp", "spot", "trade-xyz"]),
  label: z.string().trim().min(1).max(120),
  coin: z.string().trim().min(1).max(80),
  chartCoin: z.string().trim().min(1).max(100),
  dex: z.string().trim().max(40).optional(),
});

const tradingViewChartSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80).optional(),
  source: z.enum(["tradingview", "hyperliquid"]).optional(),
  symbol: z.string().trim().min(1).max(240),
});

const tradeBaseSchema = z.object({
  title: z.string().trim().min(1).max(140),
  descriptionMarkdown: markdownSchema,
  startDate: z.string().trim().refine(isValidDateKey, {
    message: "Start date must use YYYY-MM-DD format.",
  }),
  endDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidDateKey(value), {
      message: "End date must use YYYY-MM-DD format.",
    })
    .optional()
    .transform((value) => value || null),
  asset: assetSchema,
  tradingViewCharts: z.array(tradingViewChartSchema).max(12).optional(),
});

const tradeInputSchema = tradeBaseSchema.refine(
  (input) => !input.endDate || input.endDate >= input.startDate,
  "End date must be on or after the start date.",
);

const tradeUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  descriptionMarkdown: z.string().trim().max(12_000).optional(),
  startDate: z.string().trim().refine(isValidDateKey, {
    message: "Start date must use YYYY-MM-DD format.",
  }).optional(),
  endDate: z.string().trim().refine(
    (value) => value === "" || isValidDateKey(value),
    { message: "End date must use YYYY-MM-DD format." },
  ).optional().transform((value) => value || null),
  asset: assetSchema.optional(),
  tradingViewCharts: z.array(tradingViewChartSchema).max(12).optional(),
});

const entryInputSchema = z.object({
  date: z.string().trim().refine(isValidDateKey, {
    message: "Entry date must use YYYY-MM-DD format.",
  }),
  tags: entryTagsSchema,
  descriptionMarkdown: markdownSchema.refine((value) => value.length > 0, {
    message: "Entry description is required.",
  }),
});

const entryUpdateSchema = entryInputSchema.partial();

type JournalEntryDocument = Omit<JournalEntry, "id" | "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type JournalTradeDocument = Omit<
  JournalTrade,
  "id" | "entries" | "createdAt" | "updatedAt"
> & {
  _id: ObjectId;
  entries: JournalEntryDocument[];
  createdAt: Date;
  updatedAt: Date;
};

function collection(db: Db): Collection<JournalTradeDocument> {
  return db.collection<JournalTradeDocument>("journalTrades");
}

export function serializeTrade(trade: JournalTradeDocument): JournalTrade {
  return {
    id: trade._id.toString(),
    title: trade.title,
    descriptionMarkdown: trade.descriptionMarkdown,
    startDate: trade.startDate,
    endDate: trade.endDate ?? null,
    asset: trade.asset,
    tradingViewCharts: normalizeTradingViewCharts(trade.tradingViewCharts ?? []),
    entries: [...(trade.entries ?? [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(serializeEntry),
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}

function serializeEntry(entry: JournalEntryDocument): JournalEntry {
  return {
    id: entry._id.toString(),
    date: entry.date,
    tags: normalizeTags(entry.tags ?? []),
    descriptionMarkdown: entry.descriptionMarkdown,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export async function listTrades(db: Db) {
  const trades = await collection(db)
    .find()
    .sort({ startDate: -1, updatedAt: -1 })
    .toArray();

  return trades.map(serializeTrade);
}

export async function getTrade(db: Db, id: string) {
  const _id = toObjectId(id);
  if (!_id) return null;

  const trade = await collection(db).findOne({ _id });
  return trade ? serializeTrade(trade) : null;
}

export async function createTrade(db: Db, payload: unknown) {
  const input = tradeInputSchema.parse(payload);
  const now = new Date();
  const trade: JournalTradeDocument = {
    _id: new ObjectId(),
    title: input.title,
    descriptionMarkdown: input.descriptionMarkdown,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    asset: normalizeAsset(input.asset),
    tradingViewCharts: input.tradingViewCharts ?? [],
    entries: [],
    createdAt: now,
    updatedAt: now,
  };

  await collection(db).insertOne(trade);
  return serializeTrade(trade);
}

export async function updateTrade(db: Db, id: string, payload: unknown) {
  const _id = toObjectId(id);
  if (!_id) return null;

  const existing = await collection(db).findOne({ _id });
  if (!existing) return null;

  const input = tradeUpdateSchema.parse(payload);
  const nextStartDate = input.startDate ?? existing.startDate;
  const nextEndDate =
    "endDate" in input ? (input.endDate ?? null) : (existing.endDate ?? null);

  if (nextEndDate && nextEndDate < nextStartDate) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date.",
        input: nextEndDate,
      },
    ]);
  }

  const update: Document = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) update.title = input.title;
  if (input.descriptionMarkdown !== undefined) {
    update.descriptionMarkdown = input.descriptionMarkdown;
  }
  if (input.startDate !== undefined) update.startDate = input.startDate;
  if ("endDate" in input) update.endDate = input.endDate ?? null;
  if (input.asset !== undefined) update.asset = normalizeAsset(input.asset);
  if (input.tradingViewCharts !== undefined) {
    update.tradingViewCharts = normalizeTradingViewCharts(input.tradingViewCharts);
  }

  const result = await collection(db).findOneAndUpdate(
    { _id },
    { $set: update },
    { returnDocument: "after" },
  );

  return result ? serializeTrade(result) : null;
}

export async function deleteTrade(db: Db, id: string) {
  const _id = toObjectId(id);
  if (!_id) return false;

  const result = await collection(db).deleteOne({ _id });
  return result.deletedCount === 1;
}

export async function createEntry(db: Db, tradeId: string, payload: unknown) {
  const _id = toObjectId(tradeId);
  if (!_id) return null;

  const input = entryInputSchema.parse(payload);
  const now = new Date();
  const entry: JournalEntryDocument = {
    _id: new ObjectId(),
    date: input.date,
    tags: input.tags,
    descriptionMarkdown: input.descriptionMarkdown,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection(db).findOneAndUpdate(
    { _id },
    {
      $push: { entries: entry },
      $set: { updatedAt: now },
    },
    { returnDocument: "after" },
  );

  return result ? serializeTrade(result) : null;
}

export async function closeTrade(db: Db, tradeId: string, payload: unknown) {
  const _id = toObjectId(tradeId);
  if (!_id) return null;

  const existing = await collection(db).findOne({ _id });
  if (!existing) return null;

  const input = entryInputSchema.parse(payload);
  if (input.date < existing.startDate) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["date"],
        message: "Close date must be on or after the start date.",
        input: input.date,
      },
    ]);
  }

  const now = new Date();
  const entry: JournalEntryDocument = {
    _id: new ObjectId(),
    date: input.date,
    tags: input.tags,
    descriptionMarkdown: input.descriptionMarkdown,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection(db).findOneAndUpdate(
    { _id },
    {
      $push: { entries: entry },
      $set: { endDate: input.date, updatedAt: now },
    },
    { returnDocument: "after" },
  );

  return result ? serializeTrade(result) : null;
}

export async function updateEntry(
  db: Db,
  tradeId: string,
  entryId: string,
  payload: unknown,
) {
  const _id = toObjectId(tradeId);
  const entryObjectId = toObjectId(entryId);
  if (!_id || !entryObjectId) return null;

  const input = entryUpdateSchema.parse(payload);
  const set: Document = {
    updatedAt: new Date(),
    "entries.$.updatedAt": new Date(),
  };

  if (input.date !== undefined) set["entries.$.date"] = input.date;
  if (input.tags !== undefined) set["entries.$.tags"] = input.tags;
  if (input.descriptionMarkdown !== undefined) {
    set["entries.$.descriptionMarkdown"] = input.descriptionMarkdown;
  }

  const result = await collection(db).findOneAndUpdate(
    { _id, "entries._id": entryObjectId },
    { $set: set },
    { returnDocument: "after" },
  );

  return result ? serializeTrade(result) : null;
}

export async function deleteEntry(db: Db, tradeId: string, entryId: string) {
  const _id = toObjectId(tradeId);
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

  return result ? serializeTrade(result) : null;
}

function normalizeAsset(asset: JournalTradeAsset): JournalTradeAsset {
  return {
    kind: asset.kind,
    label: asset.label.trim(),
    coin: asset.coin.trim(),
    chartCoin: asset.chartCoin.trim(),
    ...(asset.dex ? { dex: asset.dex.trim() } : {}),
  };
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();

  const normalized = tags.filter((tag) => {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return normalized;
}

function normalizeTradingViewCharts(charts: JournalTradingViewChart[]) {
  const seen = new Set<string>();
  return charts.filter((chart) => {
    const key = `${chart.source ?? "tradingview"}:${chart.symbol.toLocaleUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toObjectId(id: string) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
