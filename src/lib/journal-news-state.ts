import type { JournalNewsItem, JournalNewsResponse } from "@/lib/types";

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

function compareNewsItems(left: JournalNewsItem, right: JournalNewsItem) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
  return rightTime - leftTime || left.title.localeCompare(right.title);
}
