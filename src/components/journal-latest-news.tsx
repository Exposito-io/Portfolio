"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Newspaper,
} from "lucide-react";

import { useJournalNews } from "@/components/journal-news-context";
import {
  removeJournalNewsItem,
  restoreJournalNewsItem,
} from "@/lib/journal-news-state";
import type { JournalNewsItem } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JournalLatestNews({ tradeId }: { tradeId: string }) {
  const { error: loadError, loading, news, setNews } = useJournalNews(tradeId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const items = news?.items ?? [];
  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;
  const item = items[safeIndex];

  function showPrevious() {
    setActiveIndex((index) =>
      items.length > 0 ? (index - 1 + items.length) % items.length : 0,
    );
  }

  function showNext() {
    setActiveIndex((index) =>
      items.length > 0 ? (index + 1) % items.length : 0,
    );
  }

  async function markRead(currentItem: JournalNewsItem) {
    setMarkingRead(true);
    setError("");
    setNews((current) => removeJournalNewsItem(current, currentItem));

    try {
      const response = await fetch(`/api/journal/trades/${tradeId}/news/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: currentItem.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to mark the story as read.");
      }
    } catch (markError) {
      setNews((current) => restoreJournalNewsItem(current, currentItem));
      setError(toErrorMessage(markError, "Unable to mark the story as read."));
    } finally {
      setMarkingRead(false);
    }
  }

  return (
    <section className="journal-latest-news" aria-labelledby="latest-news-title">
      <div className="journal-latest-news-header">
        <div>
          <span>News</span>
          <h2 id="latest-news-title">Latest News</h2>
        </div>
        <div
          aria-label="Latest news carousel controls"
          className="journal-latest-news-controls"
          role="group"
        >
          <button
            aria-label="Previous news story"
            disabled={items.length < 2 || markingRead}
            onClick={showPrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={17} />
          </button>
          <span aria-live="polite">
            {items.length > 0 ? `${safeIndex + 1} / ${items.length}` : "0 / 0"}
          </span>
          <button
            aria-label="Next news story"
            disabled={items.length < 2 || markingRead}
            onClick={showNext}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div aria-live="polite" className="journal-latest-news-body">
        {loading ? (
          <p className="journal-latest-news-state">Loading latest news…</p>
        ) : loadError && !news ? (
          <p className="journal-latest-news-state" title={loadError}>
            Latest news is unavailable.
          </p>
        ) : item ? (
          <>
            <a
              className="journal-latest-news-title"
              href={item.link}
              rel="noopener noreferrer"
              target="_blank"
            >
              {item.title}
              <ExternalLink aria-hidden="true" size={14} />
            </a>
            <div className="journal-latest-news-meta">
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
            <div className="journal-latest-news-footer">
              <div className="journal-latest-news-feeds">
                {item.feedKeywords.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <button
                className="journal-latest-news-mark-read"
                disabled={markingRead}
                onClick={() => void markRead(item)}
                type="button"
              >
                <Check aria-hidden="true" size={15} />
                {markingRead ? "Marking…" : "Mark as read"}
              </button>
            </div>
          </>
        ) : (
          <div className="journal-latest-news-empty">
            <Newspaper aria-hidden="true" size={20} />
            <p>{news?.feeds.length ? "You’re all caught up." : "No news feeds yet."}</p>
          </div>
        )}
      </div>

      {error ? (
        <p className="journal-latest-news-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
