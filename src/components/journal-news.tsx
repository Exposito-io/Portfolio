"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
} from "lucide-react";

import type {
  JournalNewsFeed,
  JournalNewsItem,
  JournalNewsResponse,
} from "@/lib/types";

type NewsPayload = {
  news?: JournalNewsResponse;
  error?: string;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JournalNews({ tradeId }: { tradeId: string }) {
  const [news, setNews] = useState<JournalNewsResponse | null>(null);
  const [activeFeedId, setActiveFeedId] = useState("all");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingFeedId, setRemovingFeedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadNews() {
      setLoading(true);
      setError("");
      try {
        setNews(await requestNews(tradeId, controller.signal));
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(toErrorMessage(loadError, "Unable to load news."));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadNews();
    return () => controller.abort();
  }, [tradeId]);

  const visibleItems = useMemo(() => {
    if (!news || activeFeedId === "all") return news?.items ?? [];
    return news.items.filter((item) => item.feedIds.includes(activeFeedId));
  }, [activeFeedId, news]);

  async function refreshNews() {
    setRefreshing(true);
    setError("");
    try {
      setNews(await requestNews(tradeId));
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, "Unable to refresh news."));
    } finally {
      setRefreshing(false);
    }
  }

  async function addFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setError("");

    try {
      const response = await fetch(`/api/journal/trades/${tradeId}/news/feeds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      const payload = (await response.json()) as NewsPayload;
      if (!response.ok || !payload.news) {
        throw new Error(payload.error || "Unable to add the news feed.");
      }
      setNews(payload.news);
      setKeywords("");
    } catch (addError) {
      setError(toErrorMessage(addError, "Unable to add the news feed."));
    } finally {
      setAdding(false);
    }
  }

  async function removeFeed(feed: JournalNewsFeed) {
    if (!window.confirm(`Remove the “${feed.keywords}” news feed?`)) return;

    setRemovingFeedId(feed.id);
    setError("");
    try {
      const response = await fetch(
        `/api/journal/trades/${tradeId}/news/feeds/${feed.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to remove the news feed.");
      }

      setNews((current) => removeFeedFromNews(current, feed.id));
      if (activeFeedId === feed.id) setActiveFeedId("all");
    } catch (removeError) {
      setError(toErrorMessage(removeError, "Unable to remove the news feed."));
    } finally {
      setRemovingFeedId(null);
    }
  }

  async function markRead(item: JournalNewsItem) {
    setError("");
    setNews((current) => removeItemFromNews(current, item));

    try {
      const response = await fetch(`/api/journal/trades/${tradeId}/news/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to mark the story as read.");
      }
    } catch (markError) {
      setNews((current) => restoreItemToNews(current, item));
      setError(toErrorMessage(markError, "Unable to mark the story as read."));
    }
  }

  if (loading) {
    return (
      <div className="journal-news-loading" role="status">
        <RefreshCw aria-hidden="true" className="journal-news-spin" size={18} />
        Loading Google News…
      </div>
    );
  }

  return (
    <section className="journal-news" aria-labelledby="journal-news-heading">
      <div className="journal-news-header">
        <div>
          <h2 id="journal-news-heading">Google News</h2>
          <p>Follow search keywords related to this journal.</p>
        </div>
        <button
          className="button-secondary"
          disabled={refreshing || !news?.feeds.length}
          onClick={() => void refreshNews()}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshing ? "journal-news-spin" : undefined}
            size={16}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <form className="journal-news-add-form" onSubmit={addFeed}>
        <label className="field-label" htmlFor="journal-news-keywords">
          Search keywords
        </label>
        <div className="journal-news-add-controls">
          <input
            className="input"
            disabled={adding}
            id="journal-news-keywords"
            maxLength={200}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="e.g. Ethereum ETF"
            required
            type="search"
            value={keywords}
          />
          <button className="button-primary" disabled={adding} type="submit">
            <Plus aria-hidden="true" size={16} />
            {adding ? "Adding…" : "Add feed"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {news?.feeds.some((feed) => feed.error) ? (
        <div className="alert alert-warning" role="status">
          Some feeds could not be refreshed:{" "}
          {news.feeds
            .filter((feed) => feed.error)
            .map((feed) => feed.keywords)
            .join(", ")}.
        </div>
      ) : null}

      {news?.feeds.length ? (
        <div aria-label="News feed filters" className="journal-news-filters">
          <button
            aria-pressed={activeFeedId === "all"}
            className="journal-news-filter"
            onClick={() => setActiveFeedId("all")}
            type="button"
          >
            All <span>{news.items.length}</span>
          </button>
          {news.feeds.map((feed) => (
            <div className="journal-news-feed-filter" key={feed.id}>
              <button
                aria-pressed={activeFeedId === feed.id}
                className="journal-news-filter"
                onClick={() => setActiveFeedId(feed.id)}
                type="button"
              >
                {feed.keywords} <span>{feed.unreadCount}</span>
              </button>
              <button
                aria-label={`Remove ${feed.keywords} feed`}
                className="journal-news-remove-feed"
                disabled={removingFeedId === feed.id}
                onClick={() => void removeFeed(feed)}
                title={`Remove ${feed.keywords} feed`}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {!news?.feeds.length ? (
        <div className="empty-state journal-news-empty">
          <Rss aria-hidden="true" size={24} />
          <div>
            <h2>Add your first news feed</h2>
            <p>Enter search keywords to follow them through Google News.</p>
          </div>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state journal-news-empty">
          <Check aria-hidden="true" size={24} />
          <div>
            <h2>You’re caught up</h2>
            <p>There are no unread stories in this view.</p>
          </div>
        </div>
      ) : (
        <ul className="journal-news-list">
          {visibleItems.map((item) => (
            <li className="journal-news-item" key={item.id}>
              <div className="journal-news-item-content">
                <a
                  className="journal-news-item-title"
                  href={item.link}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.title}
                  <ExternalLink aria-hidden="true" size={14} />
                </a>
                <div className="journal-news-item-meta">
                  <span>{item.source}</span>
                  {item.publishedAt ? (
                    <>
                      <span aria-hidden="true">•</span>
                      <time dateTime={item.publishedAt}>
                        {dateFormatter.format(new Date(item.publishedAt))}
                      </time>
                    </>
                  ) : null}
                </div>
                <div className="journal-news-item-feeds">
                  {item.feedKeywords.map((feedKeyword) => (
                    <span key={feedKeyword}>{feedKeyword}</span>
                  ))}
                </div>
              </div>
              <button
                className="journal-news-mark-read"
                onClick={() => void markRead(item)}
                type="button"
              >
                <Check aria-hidden="true" size={16} />
                Mark as read
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function requestNews(tradeId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/journal/trades/${tradeId}/news`, { signal });
  const payload = (await response.json()) as NewsPayload;
  if (!response.ok || !payload.news) {
    throw new Error(payload.error || "Unable to load news.");
  }
  return payload.news;
}

function removeFeedFromNews(
  news: JournalNewsResponse | null,
  feedId: string,
) {
  if (!news) return news;

  const items = news.items.flatMap((item) => {
    const associations = item.feedIds.flatMap((id, index) =>
      id === feedId ? [] : [{ id, keywords: item.feedKeywords[index] }],
    );
    if (associations.length === 0) return [];
    return [
      {
        ...item,
        feedIds: associations.map((association) => association.id),
        feedKeywords: associations.map((association) => association.keywords),
      },
    ];
  });

  return {
    ...news,
    feeds: news.feeds.filter((feed) => feed.id !== feedId),
    items,
  };
}

function removeItemFromNews(
  news: JournalNewsResponse | null,
  item: JournalNewsItem,
) {
  if (!news) return news;
  return {
    ...news,
    feeds: adjustFeedCounts(news.feeds, item.feedIds, -1),
    items: news.items.filter((candidate) => candidate.id !== item.id),
  };
}

function restoreItemToNews(
  news: JournalNewsResponse | null,
  item: JournalNewsItem,
) {
  if (!news || news.items.some((candidate) => candidate.id === item.id)) {
    return news;
  }
  return {
    ...news,
    feeds: adjustFeedCounts(news.feeds, item.feedIds, 1),
    items: [...news.items, item].sort(compareNewsItems),
  };
}

function adjustFeedCounts(
  feeds: JournalNewsFeed[],
  feedIds: string[],
  adjustment: number,
) {
  const affectedFeeds = new Set(feedIds);
  return feeds.map((feed) =>
    affectedFeeds.has(feed.id)
      ? { ...feed, unreadCount: Math.max(0, feed.unreadCount + adjustment) }
      : feed,
  );
}

function compareNewsItems(left: JournalNewsItem, right: JournalNewsItem) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
  return rightTime - leftTime || left.title.localeCompare(right.title);
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
