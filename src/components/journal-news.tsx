"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
  X,
} from "lucide-react";

import { useJournalNews } from "@/components/journal-news-context";
import { JournalNewsReadMenu } from "@/components/journal-news-read-menu";
import type {
  JournalNewsFeed,
  JournalNewsItem,
  JournalNewsResponse,
} from "@/lib/types";
import {
  getJournalNewsItemsForReadRange,
  type JournalNewsReadRange,
  removeJournalNewsItem,
  removeJournalNewsItems,
  restoreJournalNewsItem,
  restoreJournalNewsItems,
} from "@/lib/journal-news-state";

type NewsPayload = {
  news?: JournalNewsResponse;
  error?: string;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const MAX_FEED_INPUT_LENGTH = 2_048;

export function JournalNews({ tradeId }: { tradeId: string }) {
  const {
    error: loadError,
    loading,
    news,
    refreshNews: refreshSharedNews,
    setNews,
  } = useJournalNews(tradeId);
  const [activeFeedId, setActiveFeedId] = useState("all");
  const [feedInput, setFeedInput] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [markingItems, setMarkingItems] = useState(false);
  const [removingFeedId, setRemovingFeedId] = useState<string | null>(null);
  const feedInputRef = useRef<HTMLInputElement>(null);

  const visibleItems = useMemo(() => {
    if (!news || activeFeedId === "all") return news?.items ?? [];
    return news.items.filter((item) => item.feedIds.includes(activeFeedId));
  }, [activeFeedId, news]);

  async function refreshNews() {
    setRefreshing(true);
    setError("");
    try {
      await refreshSharedNews();
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
        body: JSON.stringify({ input: feedInput }),
      });
      const payload = (await response.json()) as NewsPayload;
      if (!response.ok || !payload.news) {
        throw new Error(payload.error || "Unable to add the news feed.");
      }
      setNews(payload.news);
      setFeedInput("");
      setShowAddFeed(false);
    } catch (addError) {
      setError(toErrorMessage(addError, "Unable to add the news feed."));
    } finally {
      setAdding(false);
    }
  }

  function toggleAddFeed() {
    if (showAddFeed) {
      setShowAddFeed(false);
      return;
    }
    setShowAddFeed(true);
    window.requestAnimationFrame(() => feedInputRef.current?.focus());
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
    setNews((current) => removeJournalNewsItem(current, item));

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
      setNews((current) => restoreJournalNewsItem(current, item));
      setError(toErrorMessage(markError, "Unable to mark the story as read."));
    }
  }

  async function markItemsRead(range: JournalNewsReadRange) {
    const items = getJournalNewsItemsForReadRange(visibleItems, range);
    if (items.length === 0) return;

    const activeFeed = news?.feeds.find((feed) => feed.id === activeFeedId);
    const viewName = activeFeed ? `the “${activeFeed.keywords}” feed` : "All news";
    const rangeDescription =
      range === "all"
        ? "all"
        : range === "day"
          ? "all stories older than 1 day"
          : "all stories older than 1 week";
    if (
      !window.confirm(
        `Mark ${rangeDescription} (${items.length}) in ${viewName} as read?`,
      )
    ) {
      return;
    }

    setMarkingItems(true);
    setError("");
    setNews((current) => removeJournalNewsItems(current, items));

    try {
      const response = await fetch(
        `/api/journal/trades/${tradeId}/news/read-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: items.map((item) => item.id) }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to mark all stories as read.");
      }
    } catch (markError) {
      setNews((current) => restoreJournalNewsItems(current, items));
      setError(toErrorMessage(markError, "Unable to mark stories as read."));
    } finally {
      setMarkingItems(false);
    }
  }

  if (loading) {
    return (
      <div className="journal-news-loading" role="status">
        <RefreshCw aria-hidden="true" className="journal-news-spin" size={18} />
        Loading news…
      </div>
    );
  }

  return (
    <section aria-label="News feeds" className="journal-news">
      <div className="journal-news-filter-bar">
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
                  title={feed.url ?? feed.keywords}
                  type="button"
                >
                  <span className="journal-news-filter-label">
                    {feed.keywords}
                  </span>{" "}
                  <span>{feed.unreadCount}</span>
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
        <div className="journal-news-filter-actions">
          <JournalNewsReadMenu
            disabled={visibleItems.length === 0}
            isOptionDisabled={(range) =>
              getJournalNewsItemsForReadRange(visibleItems, range).length === 0
            }
            marking={markingItems}
            onSelect={(range) => void markItemsRead(range)}
          />
          <button
            aria-controls="journal-news-add-form"
            aria-expanded={showAddFeed}
            className="button-secondary"
            onClick={toggleAddFeed}
            type="button"
          >
            {showAddFeed ? (
              <X aria-hidden="true" size={16} />
            ) : (
              <Plus aria-hidden="true" size={16} />
            )}
            {showAddFeed ? "Close" : "Add feed"}
          </button>
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
      </div>

      {showAddFeed ? (
        <form
          className="journal-news-add-form"
          id="journal-news-add-form"
          onSubmit={addFeed}
        >
          <label className="field-label" htmlFor="journal-news-input">
            Search keywords or RSS URL
          </label>
          <div className="journal-news-add-controls">
            <input
              className="input"
              disabled={adding}
              id="journal-news-input"
              maxLength={MAX_FEED_INPUT_LENGTH}
              onChange={(event) => setFeedInput(event.target.value)}
              placeholder="e.g. Ethereum ETF or https://example.com/feed.xml"
              ref={feedInputRef}
              required
              type="search"
              value={feedInput}
            />
            <button className="button-primary" disabled={adding} type="submit">
              <Plus aria-hidden="true" size={16} />
              {adding ? "Adding…" : "Add feed"}
            </button>
          </div>
        </form>
      ) : null}

      {error || loadError ? (
        <div className="alert alert-error" role="alert">
          {error || loadError}
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

      {!news?.feeds.length ? (
        <div className="empty-state journal-news-empty">
          <Rss aria-hidden="true" size={24} />
          <div>
            <h2>Add your first news feed</h2>
            <p>Use Add feed to follow keywords or a public RSS URL.</p>
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

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
