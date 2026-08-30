import { ObjectId, type Collection, type Db, type Document } from "mongodb";
import { z } from "zod";

import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getZonedJournalDateMs, isValidDateTimeKey } from "@/lib/date";
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
  kind: z.enum(["trade", "idea"]).default("trade"),
  direction: z.enum(["long", "short"]).nullable().optional().default(null),
  title: z.string().trim().min(1).max(140),
  descriptionMarkdown: markdownSchema,
  startDate: z.string().trim().refine(isValidDateTimeKey, {
    message: "Start date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format.",
  }),
  endDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidDateTimeKey(value), {
      message: "End date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format.",
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
  kind: z.enum(["trade", "idea"]).optional(),
  direction: z.enum(["long", "short"]).nullable().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  descriptionMarkdown: z.string().trim().max(12_000).optional(),
  startDate: z.string().trim().refine(isValidDateTimeKey, {
    message: "Start date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format.",
  }).optional(),
  endDate: z.string().trim().refine(
    (value) => value === "" || isValidDateTimeKey(value),
    { message: "End date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format." },
  ).optional().transform((value) => value || null),
  asset: assetSchema.optional(),
  tradingViewCharts: z.array(tradingViewChartSchema).max(12).optional(),
});

const entryInputSchema = z.object({
  date: z.string().trim().refine(isValidDateTimeKey, {
    message: "Entry date must use YYYY-MM-DD or YYYY-MM-DDTHH:mm format.",
  }),
  tags: entryTagsSchema,
  descriptionMarkdown: markdownSchema.refine((value) => value.length > 0, {
    message: "Entry description is required.",
  }),
});

const closeTradeInputSchema = entryInputSchema.extend({
  descriptionMarkdown: markdownSchema,
});

const entryUpdateSchema = entryInputSchema.partial();

type JournalEntryDocument = Omit<
  JournalEntry,
  "id" | "date" | "createdAt" | "updatedAt"
> & {
  _id: ObjectId;
  date: Date | string;
  createdAt: Date;
  updatedAt: Date;
};

type JournalTradeDocument = Omit<
  JournalTrade,
  "id" | "startDate" | "endDate" | "entries" | "createdAt" | "updatedAt"
> & {
  _id: ObjectId;
  startDate: Date | string;
  endDate: Date | string | null;
  entries: JournalEntryDocument[];
  newsFeeds?: Array<{
    _id: ObjectId;
    keywords: string;
    normalizedKeywords: string;
    createdAt: Date;
  }>;
  newsReadItemIds?: string[];
  createdAt: Date;
  updatedAt: Date;
};

function collection(db: Db): Collection<JournalTradeDocument> {
  return db.collection<JournalTradeDocument>("journalTrades");
}

export function serializeTrade(trade: JournalTradeDocument): JournalTrade {
  return {
    id: trade._id.toString(),
    kind: trade.kind ?? "trade",
    direction: trade.direction ?? null,
    title: trade.title,
    descriptionMarkdown: trade.descriptionMarkdown,
    startDate: serializeDate(trade.startDate),
    endDate: trade.endDate ? serializeDate(trade.endDate) : null,
    asset: trade.asset,
    tradingViewCharts: normalizeTradingViewCharts(trade.tradingViewCharts ?? []),
    entries: [...(trade.entries ?? [])]
      .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime())
      .map(serializeEntry),
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}

function serializeEntry(entry: JournalEntryDocument): JournalEntry {
  return {
    id: entry._id.toString(),
    date: serializeDate(entry.date),
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
    kind: input.kind,
    direction: input.kind === "idea" ? null : input.direction,
    title: input.title,
    descriptionMarkdown: input.descriptionMarkdown,
    startDate: parseInputDate(input.startDate, "start"),
    endDate: input.endDate ? parseInputDate(input.endDate, "end") : null,
    asset: normalizeAsset(input.asset),
    tradingViewCharts: input.tradingViewCharts ?? [],
    entries: [],
    newsFeeds: [],
    newsReadItemIds: [],
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
  const nextStartDate = input.startDate
    ? parseInputDate(input.startDate, "start")
    : toDate(existing.startDate);
  const nextEndDate =
    "endDate" in input
      ? input.endDate
        ? parseInputDate(input.endDate, "end")
        : null
      : existing.endDate
        ? toDate(existing.endDate)
        : null;

  if (nextEndDate && nextEndDate.getTime() < nextStartDate.getTime()) {
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

  if (input.kind !== undefined) update.kind = input.kind;
  if (input.kind === "idea") {
    update.direction = null;
  } else if (input.direction !== undefined) {
    update.direction = input.direction;
  }
  if (input.title !== undefined) update.title = input.title;
  if (input.descriptionMarkdown !== undefined) {
    update.descriptionMarkdown = input.descriptionMarkdown;
  }
  if (input.startDate !== undefined) update.startDate = nextStartDate;
  if ("endDate" in input) update.endDate = nextEndDate;
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
    date: parseInputDate(input.date, "start"),
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

  const input = closeTradeInputSchema.parse(payload);
  const closeDate = parseInputDate(input.date, "start");
  if (closeDate.getTime() < toDate(existing.startDate).getTime()) {
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
  const result = await collection(db).findOneAndUpdate(
    { _id },
    input.descriptionMarkdown
      ? {
          $push: {
            entries: {
              _id: new ObjectId(),
              date: closeDate,
              tags: input.tags,
              descriptionMarkdown: input.descriptionMarkdown,
              createdAt: now,
              updatedAt: now,
            },
          },
          $set: { endDate: closeDate, updatedAt: now },
        }
      : { $set: { endDate: closeDate, updatedAt: now } },
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

  if (input.date !== undefined) {
    set["entries.$.date"] = parseInputDate(input.date, "start");
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

function parseInputDate(value: string, dateOnlyBoundary: "start" | "end") {
  return new Date(
    getZonedJournalDateMs(value, PORTFOLIO_TIMEZONE, dateOnlyBoundary),
  );
}

function toDate(value: Date | string) {
  if (value instanceof Date) return value;
  return parseInputDate(value, "start");
}

function serializeDate(value: Date | string) {
  return toDate(value).toISOString();
}
