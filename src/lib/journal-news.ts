import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import { ObjectId, type Collection, type Db } from "mongodb";
import { z } from "zod";

import type {
  JournalNewsFeed,
  JournalNewsItem,
  JournalNewsResponse,
} from "@/lib/types";

export const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
export const JOURNAL_NEWS_FEED_LIMIT = 12;
export const JOURNAL_NEWS_KEYWORDS_LIMIT = 200;
export const JOURNAL_NEWS_READ_LIMIT = 2_000;

const MAX_RSS_BYTES = 2_000_000;
const RSS_TIMEOUT_MS = 10_000;

const feedInputSchema = z.object({
  keywords: z
    .string()
    .transform(normalizeKeywords)
    .pipe(
      z
        .string()
        .min(1, "Search keywords are required.")
        .max(
          JOURNAL_NEWS_KEYWORDS_LIMIT,
          `Search keywords cannot exceed ${JOURNAL_NEWS_KEYWORDS_LIMIT} characters.`,
        ),
    ),
});

const newsItemIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "The news item identifier is invalid.");

const readInputSchema = z.object({
  itemId: newsItemIdSchema,
});

const readManyInputSchema = z.object({
  itemIds: z
    .array(newsItemIdSchema)
    .min(1, "At least one news item is required.")
    .max(
      JOURNAL_NEWS_READ_LIMIT,
      `Cannot mark more than ${JOURNAL_NEWS_READ_LIMIT} items at once.`,
    )
    .transform((itemIds) => [...new Set(itemIds)]),
});

type NewsFeedDocument = {
  _id: ObjectId;
  keywords: string;
  normalizedKeywords: string;
  createdAt: Date;
};

type JournalNewsDocument = {
  _id: ObjectId;
  newsFeeds?: NewsFeedDocument[];
  newsReadItemIds?: string[];
};

type ParsedNewsItem = Omit<JournalNewsItem, "feedIds" | "feedKeywords">;

type FeedResult = {
  feed: NewsFeedDocument;
  items: ParsedNewsItem[];
  error?: string;
};

export type NewsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class JournalNewsHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JournalNewsHttpError";
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

function collection(db: Db): Collection<JournalNewsDocument> {
  return db.collection<JournalNewsDocument>("journalTrades");
}

export function buildGoogleNewsUrl(keywords: string) {
  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set("q", normalizeKeywords(keywords));
  return url.toString();
}

export function parseGoogleNewsRss(xml: string): ParsedNewsItem[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const rss = recordValue(parsed.rss);
  const channel = recordValue(rss?.channel);
  const rawItems = arrayValue(channel?.item);
  const seen = new Set<string>();
  const items: ParsedNewsItem[] = [];

  for (const rawItem of rawItems) {
    const item = recordValue(rawItem);
    if (!item) continue;

    const title = textValue(item.title);
    const link = textValue(item.link);
    const guid = textValue(item.guid);
    const source = textValue(item.source);
    if (!title || !link || (!guid && !link)) continue;

    try {
      const articleUrl = new URL(link);
      if (articleUrl.protocol !== "https:" && articleUrl.protocol !== "http:") {
        continue;
      }
    } catch {
      continue;
    }

    const id = createNewsItemId(guid || link);
    if (seen.has(id)) continue;
    seen.add(id);

    const publishedAt = parsePublishedAt(textValue(item.pubDate));
    items.push({
      id,
      title,
      link,
      source: source || "Unknown source",
      publishedAt,
    });
  }

  return items;
}

export async function fetchGoogleNewsFeed(
  keywords: string,
  fetchImpl: NewsFetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(buildGoogleNewsUrl(keywords), {
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Google News returned HTTP ${response.status}.`);
    }

    const xml = await response.text();
    if (Buffer.byteLength(xml, "utf8") > MAX_RSS_BYTES) {
      throw new Error("Google News returned an unexpectedly large feed.");
    }

    return parseGoogleNewsRss(xml);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Google News took too long to respond.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJournalNews(
  db: Db,
  journalId: string,
  fetchImpl: NewsFetch = fetch,
): Promise<JournalNewsResponse | null> {
  const _id = toObjectId(journalId);
  if (!_id) return null;

  const journal = await collection(db).findOne({ _id });
  if (!journal) return null;

  const feeds = journal.newsFeeds ?? [];
  const readIds = new Set(journal.newsReadItemIds ?? []);
  const settledResults = await Promise.allSettled(
    feeds.map(async (feed): Promise<FeedResult> => ({
      feed,
      items: await fetchGoogleNewsFeed(feed.keywords, fetchImpl),
    })),
  );

  const results = settledResults.map((result, index): FeedResult => {
    if (result.status === "fulfilled") return result.value;
    return {
      feed: feeds[index],
      items: [],
      error: toFeedErrorMessage(result.reason),
    };
  });

  return aggregateNews(results, readIds);
}

export async function addJournalNewsFeed(
  db: Db,
  journalId: string,
  payload: unknown,
  fetchImpl: NewsFetch = fetch,
) {
  const _id = toObjectId(journalId);
  if (!_id) return null;

  const input = feedInputSchema.parse(payload);
  const journal = await collection(db).findOne({ _id });
  if (!journal) return null;

  const feeds = journal.newsFeeds ?? [];
  if (feeds.length >= JOURNAL_NEWS_FEED_LIMIT) {
    throw new JournalNewsHttpError(
      `A journal can have at most ${JOURNAL_NEWS_FEED_LIMIT} news feeds.`,
      400,
    );
  }

  const normalizedKeywords = input.keywords.toLocaleLowerCase();
  if (feeds.some((feed) => feed.normalizedKeywords === normalizedKeywords)) {
    throw new JournalNewsHttpError(
      "A feed with these search keywords already exists.",
      409,
    );
  }

  const feed: NewsFeedDocument = {
    _id: new ObjectId(),
    keywords: input.keywords,
    normalizedKeywords,
    createdAt: new Date(),
  };

  await collection(db).updateOne({ _id }, { $push: { newsFeeds: feed } });
  return getJournalNews(db, journalId, fetchImpl);
}

export async function removeJournalNewsFeed(
  db: Db,
  journalId: string,
  feedId: string,
) {
  const _id = toObjectId(journalId);
  const feedObjectId = toObjectId(feedId);
  if (!_id || !feedObjectId) return false;

  const result = await collection(db).updateOne(
    { _id, "newsFeeds._id": feedObjectId },
    { $pull: { newsFeeds: { _id: feedObjectId } } },
  );
  return result.matchedCount === 1;
}

export async function markJournalNewsItemRead(
  db: Db,
  journalId: string,
  payload: unknown,
) {
  const input = readInputSchema.parse(payload);
  return persistJournalNewsReadItems(db, journalId, [input.itemId]);
}

export async function markJournalNewsItemsRead(
  db: Db,
  journalId: string,
  payload: unknown,
) {
  const input = readManyInputSchema.parse(payload);
  return persistJournalNewsReadItems(db, journalId, input.itemIds);
}

async function persistJournalNewsReadItems(
  db: Db,
  journalId: string,
  itemIds: string[],
) {
  const _id = toObjectId(journalId);
  if (!_id) return false;

  const journal = await collection(db).findOne({ _id });
  if (!journal) return false;

  const incomingIds = new Set(itemIds);
  const nextReadIds = [
    ...(journal.newsReadItemIds ?? []).filter((id) => !incomingIds.has(id)),
    ...incomingIds,
  ].slice(-JOURNAL_NEWS_READ_LIMIT);

  const result = await collection(db).updateOne(
    { _id },
    { $set: { newsReadItemIds: nextReadIds } },
  );
  return result.matchedCount === 1;
}

function aggregateNews(
  results: FeedResult[],
  readIds: Set<string>,
): JournalNewsResponse {
  const itemsById = new Map<string, JournalNewsItem>();
  const unreadCounts = new Map<string, number>();

  for (const result of results) {
    const feedId = result.feed._id.toString();
    let unreadCount = 0;

    for (const item of result.items) {
      if (readIds.has(item.id)) continue;
      unreadCount += 1;

      const existing = itemsById.get(item.id);
      if (existing) {
        if (!existing.feedIds.includes(feedId)) {
          existing.feedIds.push(feedId);
          existing.feedKeywords.push(result.feed.keywords);
        }
        continue;
      }

      itemsById.set(item.id, {
        ...item,
        feedIds: [feedId],
        feedKeywords: [result.feed.keywords],
      });
    }

    unreadCounts.set(feedId, unreadCount);
  }

  const items = [...itemsById.values()].sort((left, right) => {
    const rightTime = right.publishedAt
      ? new Date(right.publishedAt).getTime()
      : Number.NEGATIVE_INFINITY;
    const leftTime = left.publishedAt
      ? new Date(left.publishedAt).getTime()
      : Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });

  const feeds: JournalNewsFeed[] = results.map(({ feed, error }) => ({
    id: feed._id.toString(),
    keywords: feed.keywords,
    createdAt: feed.createdAt.toISOString(),
    unreadCount: unreadCounts.get(feed._id.toString()) ?? 0,
    ...(error ? { error } : {}),
  }));

  return {
    feeds,
    items,
    fetchedAt: new Date().toISOString(),
  };
}

function createNewsItemId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeKeywords(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parsePublishedAt(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  const record = recordValue(value);
  return record ? textValue(record["#text"]) : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toFeedErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load this feed.";
}

function toObjectId(id: string) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
