"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ExternalLink, Newspaper, RefreshCw, Rss } from "lucide-react";

import { JournalNewsReadMenu } from "@/components/journal-news-read-menu";
import {
  getJournalNewsItemsForReadRange,
  type JournalNewsReadRange,
  removeJournalNewsItems,
  restoreJournalNewsItems,
} from "@/lib/journal-news-state";
import type {
  JournalNewsItem,
  OpenJournalNews,
  OpenJournalNewsResponse,
} from "@/lib/types";

type NewsPayload = {
  news?: OpenJournalNewsResponse;
  error?: string;
};

type DisplayAssociation = {
  journalId: string;
  journalTitle: string;
  feedIds: string[];
  feedKeywords: string[];
};

type DisplayItem = JournalNewsItem & {
  journals: DisplayAssociation[];
};

type FeedOption = {
  id: string;
  journalId: string;
  feedId: string;
  label: string;
  count: number;
  error?: string;
};

type ReadTarget = {
  item: JournalNewsItem;
  journalId: string;
};

const ALL_JOURNALS = "all";
const ALL_FEEDS = "all";
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function OpenJournalNewsReader() {
  const [snapshot, setSnapshot] = useState<OpenJournalNewsResponse | null>(null);
  const [activeJournalId, setActiveJournalId] = useState(ALL_JOURNALS);
  const [activeFeedId, setActiveFeedId] = useState(ALL_FEEDS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [markingItems, setMarkingItems] = useState(false);
  const [markingItemIds, setMarkingItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadNews = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/news");
      const payload = (await response.json()) as NewsPayload;
      if (!response.ok || !payload.news) {
        throw new Error(payload.error || "Unable to load news.");
      }
      setSnapshot(payload.news);
    } catch (loadError) {
      setError(toErrorMessage(loadError, "Unable to load news."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadNews(true), 0);
    return () => window.clearTimeout(timeout);
  }, [loadNews]);

  const journalTabs = useMemo(() => snapshot?.journals ?? [], [snapshot]);
  const allItems = useMemo(
    () => mergeItems(journalTabs, ALL_JOURNALS, ALL_FEEDS),
    [journalTabs],
  );
  const feedOptions = useMemo(
    () => buildFeedOptions(journalTabs, activeJournalId),
    [activeJournalId, journalTabs],
  );
  const visibleItems = useMemo(
    () => mergeItems(journalTabs, activeJournalId, activeFeedId),
    [activeFeedId, activeJournalId, journalTabs],
  );
  const failedFeeds = feedOptions.filter((feed) => feed.error);

  function selectJournal(journalId: string) {
    setActiveJournalId(journalId);
    setActiveFeedId(ALL_FEEDS);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabCount = journalTabs.length + 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabCount - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabCount) %
            tabCount;
    const nextId = nextIndex === 0 ? ALL_JOURNALS : journalTabs[nextIndex - 1].id;
    selectJournal(nextId);
    tabRefs.current[nextIndex]?.focus();
  }

  async function markRead(item: DisplayItem) {
    const targets = getReadTargets(snapshot, [item]);
    if (!targets.length) return;

    setError("");
    setMarkingItemIds((current) => new Set(current).add(item.id));
    setSnapshot((current) => updateJournalReadTargets(current, targets, "remove"));

    const results = await Promise.allSettled(
      targets.map(async ({ journalId }) => {
        const response = await fetch(
          `/api/journal/trades/${journalId}/news/read`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: item.id }),
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to mark the story as read.");
        }
        return journalId;
      }),
    );

    const failedTargets = targets.filter(
      (_, index) => results[index].status === "rejected",
    );
    if (failedTargets.length) {
      setSnapshot((current) =>
        updateJournalReadTargets(current, failedTargets, "restore"),
      );
      setError(
        failedTargets.length === targets.length
          ? "Unable to mark the story as read."
          : "The story was marked read in some journals, but not all of them.",
      );
    }

    setMarkingItemIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function markItemsRead(range: JournalNewsReadRange) {
    const items = getJournalNewsItemsForReadRange(visibleItems, range);
    const targets = getReadTargets(snapshot, items);
    if (!targets.length) return;

    const activeJournal = journalTabs.find(
      (journal) => journal.id === activeJournalId,
    );
    const activeFeed = feedOptions.find((feed) => feed.id === activeFeedId);
    const scopeName = activeFeed
      ? `the “${activeFeed.label}” feed`
      : activeJournal
        ? `“${activeJournal.title}”`
        : "all open journals";
    const rangeDescription =
      range === "all"
        ? "all"
        : range === "day"
          ? "all articles older than 1 day"
          : "all articles older than 1 week";
    if (
      !window.confirm(
        `Mark ${rangeDescription} (${items.length}) in ${scopeName} as read?`,
      )
    ) {
      return;
    }

    setMarkingItems(true);
    setError("");
    setSnapshot((current) => updateJournalReadTargets(current, targets, "remove"));

    const targetsByJournal = groupReadTargetsByJournal(targets);
    const journalTargets = [...targetsByJournal.entries()];
    const results = await Promise.allSettled(
      journalTargets.map(async ([journalId, journalItems]) => {
        const response = await fetch(
          `/api/journal/trades/${journalId}/news/read-all`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemIds: journalItems.map((item) => item.id),
            }),
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to mark stories as read.");
        }
        return journalId;
      }),
    );

    const failedJournalIds = new Set(
      journalTargets.flatMap(([journalId], index) =>
        results[index].status === "rejected" ? [journalId] : [],
      ),
    );
    if (failedJournalIds.size) {
      setSnapshot((current) =>
        updateJournalReadTargets(
          current,
          targets.filter((target) => failedJournalIds.has(target.journalId)),
          "restore",
        ),
      );
      setError(
        failedJournalIds.size === journalTargets.length
          ? "Unable to mark stories as read."
          : "Stories were marked read in some journals, but not all of them.",
      );
    }

    setMarkingItems(false);
  }

  if (loading) {
    return (
      <main className="news-page-shell">
        <div className="journal-news-loading" role="status">
          <RefreshCw aria-hidden="true" className="journal-news-spin" size={18} />
          Loading news…
        </div>
      </main>
    );
  }

  return (
    <main className="news-page-shell">
      <section className="panel open-journal-news" aria-labelledby="news-page-title">
        <div className="open-journal-news-heading">
          <div className="panel-heading">
            <h1 id="news-page-title">News</h1>
          </div>
          <div className="open-journal-news-actions">
            <JournalNewsReadMenu
              disabled={visibleItems.length === 0}
              isOptionDisabled={(range) =>
                getJournalNewsItemsForReadRange(visibleItems, range).length === 0
              }
              marking={markingItems}
              onSelect={(range) => void markItemsRead(range)}
            />
            <button
              aria-label="Refresh news"
              className="icon-button open-journal-news-refresh"
              disabled={refreshing}
              onClick={() => void loadNews()}
              title="Refresh news"
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={refreshing ? "journal-news-spin" : undefined}
                size={18}
              />
            </button>
          </div>
        </div>

        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        {!snapshot ? null : !snapshot.journals.length ? (
          <div className="empty-state open-journal-news-empty">
            <Newspaper aria-hidden="true" size={24} />
            <div>
              <h2>No open journals</h2>
              <p>
                Open or create a journal item from the <Link href="/journal">Journal page</Link>.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              aria-label="Journal news filters"
              className="open-journal-news-tabs"
              role="tablist"
            >
              <button
                aria-controls="open-journal-news-panel"
                aria-selected={activeJournalId === ALL_JOURNALS}
                className="open-journal-news-tab"
                id="open-journal-news-tab-all"
                onClick={() => selectJournal(ALL_JOURNALS)}
                onKeyDown={(event) => handleTabKeyDown(event, 0)}
                ref={(element) => {
                  tabRefs.current[0] = element;
                }}
                role="tab"
                tabIndex={activeJournalId === ALL_JOURNALS ? 0 : -1}
                type="button"
              >
                All <span>{allItems.length}</span>
              </button>
              {journalTabs.map((journal, index) => (
                <button
                  aria-controls="open-journal-news-panel"
                  aria-selected={activeJournalId === journal.id}
                  className="open-journal-news-tab"
                  id={`open-journal-news-tab-${journal.id}`}
                  key={journal.id}
                  onClick={() => selectJournal(journal.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index + 1)}
                  ref={(element) => {
                    tabRefs.current[index + 1] = element;
                  }}
                  role="tab"
                  tabIndex={activeJournalId === journal.id ? 0 : -1}
                  type="button"
                >
                  {journal.title} <span>{journal.news.items.length}</span>
                </button>
              ))}
            </div>

            <div
              aria-labelledby={`open-journal-news-tab-${activeJournalId}`}
              id="open-journal-news-panel"
              role="tabpanel"
            >
              {activeJournalId !== ALL_JOURNALS && feedOptions.length ? (
                <div aria-label="Feed filters" className="open-journal-news-feeds">
                  <button
                    aria-pressed={activeFeedId === ALL_FEEDS}
                    className="journal-news-filter"
                    onClick={() => setActiveFeedId(ALL_FEEDS)}
                    type="button"
                  >
                    All feeds <span>{mergeItems(journalTabs, activeJournalId, ALL_FEEDS).length}</span>
                  </button>
                  {feedOptions.map((feed) => (
                    <button
                      aria-label={`${feed.label} ${feed.count}`}
                      aria-pressed={activeFeedId === feed.id}
                      className="journal-news-filter"
                      key={feed.id}
                      onClick={() => setActiveFeedId(feed.id)}
                      title={feed.label}
                      type="button"
                    >
                      <span className="journal-news-filter-label">{feed.label}</span>
                      <span>{feed.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {failedFeeds.length ? (
                <div className="alert alert-warning" role="status">
                  Some feeds could not be refreshed: {failedFeeds.map((feed) => feed.label).join(", ")}.
                </div>
              ) : null}

              {feedOptions.length === 0 ? (
                <div className="empty-state open-journal-news-empty">
                  <Rss aria-hidden="true" size={24} />
                  <div>
                    <h2>No feeds to show</h2>
                    <p>Add feeds from the News tab of an open journal.</p>
                  </div>
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="empty-state open-journal-news-empty">
                  <Check aria-hidden="true" size={24} />
                  <div>
                    <h2>You’re caught up</h2>
                    <p>There are no unread stories in this view.</p>
                  </div>
                </div>
              ) : (
                <ul className="journal-news-list open-journal-news-list">
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
                        <div className="open-journal-news-labels">
                          {item.journals.flatMap((journal) =>
                            journal.feedKeywords.map((feedKeyword, index) => (
                              <span key={`${journal.journalId}:${journal.feedIds[index]}`}>
                                <b>{journal.journalTitle}</b>
                                {feedKeyword}
                              </span>
                            )),
                          )}
                        </div>
                      </div>
                      <button
                        className="journal-news-mark-read"
                        disabled={markingItemIds.has(item.id)}
                        onClick={() => void markRead(item)}
                        type="button"
                      >
                        <Check aria-hidden="true" size={16} />
                        {markingItemIds.has(item.id) ? "Marking…" : "Mark as read"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function buildFeedOptions(journals: OpenJournalNews[], activeJournalId: string) {
  return journals
    .filter(
      (journal) =>
        activeJournalId === ALL_JOURNALS || journal.id === activeJournalId,
    )
    .flatMap((journal): FeedOption[] =>
      journal.news.feeds.map((feed) => ({
        id: `${journal.id}:${feed.id}`,
        journalId: journal.id,
        feedId: feed.id,
        label:
          activeJournalId === ALL_JOURNALS
            ? `${journal.title} · ${feed.keywords}`
            : feed.keywords,
        count: feed.unreadCount,
        error: feed.error,
      })),
    );
}

function mergeItems(
  journals: OpenJournalNews[],
  activeJournalId: string,
  activeFeedId: string,
) {
  const feedSelection =
    activeFeedId === ALL_FEEDS
      ? null
      : buildFeedOptions(journals, activeJournalId).find(
          (feed) => feed.id === activeFeedId,
        ) ?? null;
  const itemsById = new Map<string, DisplayItem>();

  for (const journal of journals) {
    if (activeJournalId !== ALL_JOURNALS && journal.id !== activeJournalId) continue;
    if (feedSelection && journal.id !== feedSelection.journalId) continue;

    for (const item of journal.news.items) {
      const associations = item.feedIds.flatMap((feedId, index) =>
        !feedSelection || feedId === feedSelection.feedId
          ? [{ feedId, feedKeyword: item.feedKeywords[index] }]
          : [],
      );
      if (!associations.length) continue;

      const journalAssociation: DisplayAssociation = {
        journalId: journal.id,
        journalTitle: journal.title,
        feedIds: associations.map(({ feedId }) => feedId),
        feedKeywords: associations.map(({ feedKeyword }) => feedKeyword),
      };
      const existing = itemsById.get(item.id);
      if (existing) existing.journals.push(journalAssociation);
      else itemsById.set(item.id, { ...item, journals: [journalAssociation] });
    }
  }

  return [...itemsById.values()].sort(compareItems);
}

function getReadTargets(
  snapshot: OpenJournalNewsResponse | null,
  items: DisplayItem[],
) {
  if (!snapshot) return [];
  const journalIdsByItemId = new Map(
    items.map((item) => [
      item.id,
      new Set(item.journals.map((journal) => journal.journalId)),
    ]),
  );
  return snapshot.journals.flatMap((journal): ReadTarget[] =>
    journal.news.items.flatMap((item) =>
      journalIdsByItemId.get(item.id)?.has(journal.id)
        ? [{ item, journalId: journal.id }]
        : [],
    ),
  );
}

function updateJournalReadTargets(
  snapshot: OpenJournalNewsResponse | null,
  targets: ReadTarget[],
  action: "remove" | "restore",
) {
  if (!snapshot) return snapshot;
  const targetsByJournal = groupReadTargetsByJournal(targets);
  return {
    ...snapshot,
    journals: snapshot.journals.map((journal) => {
      const journalItems = targetsByJournal.get(journal.id);
      if (!journalItems) return journal;
      return {
        ...journal,
        news:
          action === "remove"
            ? removeJournalNewsItems(journal.news, journalItems) ?? journal.news
            : restoreJournalNewsItems(journal.news, journalItems) ?? journal.news,
      };
    }),
  };
}

function groupReadTargetsByJournal(targets: ReadTarget[]) {
  const targetsByJournal = new Map<string, JournalNewsItem[]>();
  for (const target of targets) {
    const items = targetsByJournal.get(target.journalId) ?? [];
    if (!items.some((item) => item.id === target.item.id)) items.push(target.item);
    targetsByJournal.set(target.journalId, items);
  }
  return targetsByJournal;
}

function compareItems(left: JournalNewsItem, right: JournalNewsItem) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
  return rightTime - leftTime || left.title.localeCompare(right.title);
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
