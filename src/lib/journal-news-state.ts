import type { JournalNewsItem, JournalNewsResponse } from "@/lib/types";

export type JournalNewsReadRange = "all" | "day" | "week";

const READ_RANGE_AGE_MS: Record<Exclude<JournalNewsReadRange, "all">, number> = {
  day: 24 * 60 * 60 * 1_000,
  week: 7 * 24 * 60 * 60 * 1_000,
};

export function getJournalNewsItemsForReadRange<T extends JournalNewsItem>(
  items: T[],
  range: JournalNewsReadRange,
  now = Date.now(),
) {
  if (range === "all") return items;
  const cutoff = now - READ_RANGE_AGE_MS[range];
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    const publishedAt = new Date(item.publishedAt).getTime();
    return Number.isFinite(publishedAt) && publishedAt < cutoff;
  });
}

export function removeJournalNewsItem(
  news: JournalNewsResponse | null,
  item: JournalNewsItem,
) {
  if (!news) return news;
  const affectedFeeds = new Set(item.feedIds);
  return {
    ...news,
    feeds: news.feeds.map((feed) =>
      affectedFeeds.has(feed.id)
        ? { ...feed, unreadCount: Math.max(0, feed.unreadCount - 1) }
        : feed,
    ),
    items: news.items.filter((candidate) => candidate.id !== item.id),
  };
}

export function restoreJournalNewsItem(
  news: JournalNewsResponse | null,
  item: JournalNewsItem,
) {
  if (!news || news.items.some((candidate) => candidate.id === item.id)) {
    return news;
  }
  const affectedFeeds = new Set(item.feedIds);
  return {
    ...news,
    feeds: news.feeds.map((feed) =>
      affectedFeeds.has(feed.id)
        ? { ...feed, unreadCount: feed.unreadCount + 1 }
        : feed,
    ),
    items: [...news.items, item].sort(compareNewsItems),
  };
}

export function removeJournalNewsItems(
  news: JournalNewsResponse | null,
  items: JournalNewsItem[],
) {
  if (!news) return news;
  const itemIds = new Set(items.map((item) => item.id));
  const feedAdjustments = countItemsByFeed(items);

  return {
    ...news,
    feeds: news.feeds.map((feed) => ({
      ...feed,
      unreadCount: Math.max(
        0,
        feed.unreadCount - (feedAdjustments.get(feed.id) ?? 0),
      ),
    })),
    items: news.items.filter((item) => !itemIds.has(item.id)),
  };
}

export function restoreJournalNewsItems(
  news: JournalNewsResponse | null,
  items: JournalNewsItem[],
) {
  if (!news) return news;
  const existingIds = new Set(news.items.map((item) => item.id));
  const missingItems = items.filter((item) => !existingIds.has(item.id));
  if (missingItems.length === 0) return news;

  const feedAdjustments = countItemsByFeed(missingItems);
  return {
    ...news,
    feeds: news.feeds.map((feed) => ({
      ...feed,
      unreadCount: feed.unreadCount + (feedAdjustments.get(feed.id) ?? 0),
    })),
    items: [...news.items, ...missingItems].sort(compareNewsItems),
  };
}

function countItemsByFeed(items: JournalNewsItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const feedId of item.feedIds) {
      counts.set(feedId, (counts.get(feedId) ?? 0) + 1);
    }
  }
  return counts;
}

function compareNewsItems(left: JournalNewsItem, right: JournalNewsItem) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
  return rightTime - leftTime || left.title.localeCompare(right.title);
}
