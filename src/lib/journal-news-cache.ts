import { createHash } from "node:crypto";

import { ObjectId, type Collection, type Db } from "mongodb";

export const JOURNAL_NEWS_CACHE_INTERVAL_MS = 30 * 60 * 1_000;
export const JOURNAL_NEWS_RESPONSE_LIMIT = 500;

export type CacheableNewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
};

type NewsQueryCacheDocument = {
  _id: string;
  normalizedKeywords: string;
  provider: "google";
  edition: "US:en";
  createdAt: Date;
  updatedAt: Date;
  lastAttemptAt: Date;
  nextAllowedAt: Date;
  lastSuccessAt?: Date;
  lastResultCount?: number;
  lastError?: string;
  refreshToken?: string;
};

type NewsArticleDocument = {
  _id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: Date | null;
  queryKeys: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type NewsReadReceiptDocument = {
  _id: string;
  journalId: ObjectId;
  itemId: string;
  readAt: Date;
};

type CacheLoadOptions = {
  now?: Date;
  limit?: number;
};

type CachedNewsResult = {
  items: CacheableNewsItem[];
  error?: string;
};

const QUERY_CACHE_COLLECTION = "journalNewsQueryCaches";
const ARTICLE_COLLECTION = "journalNewsArticles";
const READ_RECEIPT_COLLECTION = "journalNewsReadReceipts";
const GOOGLE_NEWS_EDITION = "US:en";
const GOOGLE_EMPTY_WARNING =
  "Google News returned no stories; showing saved results.";
const REFRESH_WAIT_TIMEOUT_MS = 12_000;
const REFRESH_WAIT_POLL_MS = 100;
const refreshes = new Map<string, Promise<void>>();
const indexPromises = new Map<string, Promise<void>>();

function queryCacheCollection(db: Db): Collection<NewsQueryCacheDocument> {
  return db.collection<NewsQueryCacheDocument>(QUERY_CACHE_COLLECTION);
}

function articleCollection(db: Db): Collection<NewsArticleDocument> {
  return db.collection<NewsArticleDocument>(ARTICLE_COLLECTION);
}

function readReceiptCollection(db: Db): Collection<NewsReadReceiptDocument> {
  return db.collection<NewsReadReceiptDocument>(READ_RECEIPT_COLLECTION);
}

export function normalizeJournalNewsQuery(keywords: string) {
  return keywords.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getJournalNewsQueryKey(keywords: string) {
  return createHash("sha256")
    .update(`google|${GOOGLE_NEWS_EDITION}|${normalizeJournalNewsQuery(keywords)}`)
    .digest("hex");
}

export async function getCachedGoogleNews(
  db: Db,
  keywords: string,
  readItemIds: ReadonlySet<string>,
  fetchItems: () => Promise<CacheableNewsItem[]>,
  options: CacheLoadOptions = {},
): Promise<CachedNewsResult> {
  await ensureJournalNewsCacheIndexes(db);

  const now = options.now ?? new Date();
  const queryKey = getJournalNewsQueryKey(keywords);
  const cache = await queryCacheCollection(db).findOne({ _id: queryKey });
  const flightKey = `${db.databaseName}:${queryKey}`;

  if (!cache || cache.nextAllowedAt.getTime() <= now.getTime()) {
    let refresh = refreshes.get(flightKey);
    if (!refresh) {
      refresh = refreshGoogleNewsQuery(db, queryKey, keywords, fetchItems, now)
        .finally(() => refreshes.delete(flightKey));
      refreshes.set(flightKey, refresh);
    }
    await refresh;
  } else if (cache.refreshToken) {
    const refresh = refreshes.get(flightKey);
    if (refresh) await refresh;
    else await waitForClaimedRefresh(db, queryKey);
  }

  const [latestCache, articles] = await Promise.all([
    queryCacheCollection(db).findOne({ _id: queryKey }),
    loadCachedArticles(
      db,
      queryKey,
      readItemIds,
      options.limit ?? JOURNAL_NEWS_RESPONSE_LIMIT,
    ),
  ]);

  return {
    items: articles,
    ...(latestCache?.lastError ? { error: latestCache.lastError } : {}),
  };
}

export async function getJournalNewsReadItemIds(db: Db, journalId: ObjectId) {
  await ensureJournalNewsCacheIndexes(db);
  const receipts = await readReceiptCollection(db)
    .find({ journalId })
    .project({ _id: 0, itemId: 1 })
    .toArray();
  return receipts.map(({ itemId }) => itemId);
}

export async function saveJournalNewsReadReceipts(
  db: Db,
  journalId: ObjectId,
  itemIds: string[],
) {
  await ensureJournalNewsCacheIndexes(db);
  const now = new Date();
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return;

  await readReceiptCollection(db).bulkWrite(
    uniqueItemIds.map((itemId) => ({
      updateOne: {
        filter: { _id: `${journalId.toString()}:${itemId}` },
        update: {
          $set: { journalId, itemId, readAt: now },
        },
        upsert: true,
      },
    })),
  );
}

async function refreshGoogleNewsQuery(
  db: Db,
  queryKey: string,
  keywords: string,
  fetchItems: () => Promise<CacheableNewsItem[]>,
  now: Date,
) {
  const refreshToken = new ObjectId().toString();
  const claimed = await claimRefresh(
    db,
    queryKey,
    normalizeJournalNewsQuery(keywords),
    refreshToken,
    now,
  );
  if (!claimed) {
    await waitForClaimedRefresh(db, queryKey);
    return;
  }

  try {
    const items = await fetchItems();
    if (items.length > 0) {
      await saveArticles(db, queryKey, items, now);
      await queryCacheCollection(db).updateOne(
        { _id: queryKey, refreshToken },
        {
          $set: {
            lastSuccessAt: now,
            lastResultCount: items.length,
            updatedAt: now,
          },
          $unset: { lastError: "", refreshToken: "" },
        },
      );
      return;
    }

    await queryCacheCollection(db).updateOne(
      { _id: queryKey, refreshToken },
      {
        $set: {
          lastError: GOOGLE_EMPTY_WARNING,
          lastResultCount: 0,
          updatedAt: now,
        },
        $unset: { refreshToken: "" },
      },
    );
  } catch (error) {
    const reason = toErrorMessage(error);
    await queryCacheCollection(db).updateOne(
      { _id: queryKey, refreshToken },
      {
        $set: {
          lastError: `Google News refresh failed: ${reason} Showing saved results.`,
          updatedAt: now,
        },
        $unset: { refreshToken: "" },
      },
    );
  }
}

async function waitForClaimedRefresh(db: Db, queryKey: string) {
  const deadline = Date.now() + REFRESH_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const cache = await queryCacheCollection(db).findOne({ _id: queryKey });
    if (!cache?.refreshToken) return;
    await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_POLL_MS));
  }
}

async function claimRefresh(
  db: Db,
  queryKey: string,
  normalizedKeywords: string,
  refreshToken: string,
  now: Date,
) {
  const nextAllowedAt = new Date(
    now.getTime() + JOURNAL_NEWS_CACHE_INTERVAL_MS,
  );
  const cache = queryCacheCollection(db);
  const result = await cache.updateOne(
    { _id: queryKey, nextAllowedAt: { $lte: now } },
    {
      $set: {
        lastAttemptAt: now,
        nextAllowedAt,
        refreshToken,
        updatedAt: now,
      },
    },
  );
  if (result.matchedCount === 1) return true;

  try {
    await cache.insertOne({
      _id: queryKey,
      normalizedKeywords,
      provider: "google",
      edition: GOOGLE_NEWS_EDITION,
      createdAt: now,
      updatedAt: now,
      lastAttemptAt: now,
      nextAllowedAt,
      refreshToken,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

async function saveArticles(
  db: Db,
  queryKey: string,
  items: CacheableNewsItem[],
  now: Date,
) {
  await articleCollection(db).bulkWrite(
    items.map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: {
          $set: {
            title: item.title,
            link: item.link,
            source: item.source,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            lastSeenAt: now,
          },
          $setOnInsert: { firstSeenAt: now },
          $addToSet: { queryKeys: queryKey },
        },
        upsert: true,
      },
    })),
  );
}

async function loadCachedArticles(
  db: Db,
  queryKey: string,
  readItemIds: ReadonlySet<string>,
  limit: number,
) {
  const excludedIds = [...readItemIds];
  const articles = await articleCollection(db)
    .find({
      queryKeys: queryKey,
      ...(excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {}),
    })
    .sort({ publishedAt: -1, title: 1 })
    .limit(limit)
    .toArray();

  return articles.map(
    ({ _id, title, link, source, publishedAt }): CacheableNewsItem => ({
      id: _id,
      title,
      link,
      source,
      publishedAt: publishedAt?.toISOString() ?? null,
    }),
  );
}

async function ensureJournalNewsCacheIndexes(db: Db) {
  const databaseKey = db.databaseName;
  let promise = indexPromises.get(databaseKey);
  if (!promise) {
    promise = Promise.all([
      articleCollection(db).createIndex({ queryKeys: 1, publishedAt: -1 }),
      readReceiptCollection(db).createIndex(
        { journalId: 1, itemId: 1 },
        { unique: true },
      ),
    ])
      .then(() => undefined)
      .catch((error) => {
        indexPromises.delete(databaseKey);
        throw error;
      });
    indexPromises.set(databaseKey, promise);
  }
  return promise;
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11_000,
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load this feed.";
}
