import { createHash } from "node:crypto";

import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import {
  addJournalNewsFeed,
  buildBingNewsUrl,
  buildGoogleNewsUrl,
  fetchNewsFeed,
  fetchGoogleNewsFeed,
  getJournalNews,
  getOpenJournalsNews,
  JOURNAL_NEWS_FEED_LIMIT,
  JOURNAL_NEWS_READ_LIMIT,
  JournalNewsHttpError,
  markJournalNewsItemRead,
  markJournalNewsItemsRead,
  parseGoogleNewsRss,
  parseNewsFeed,
  removeJournalNewsFeed,
  type NewsFetch,
} from "@/lib/journal-news";
import {
  getCachedGoogleNews,
  getJournalNewsQueryKey,
  JOURNAL_NEWS_CACHE_INTERVAL_MS,
  JOURNAL_NEWS_RESPONSE_LIMIT,
} from "@/lib/journal-news-cache";

describe("Google News RSS", () => {
  it("encodes normalized keywords into the fixed Google News URL", () => {
    const url = new URL(buildGoogleNewsUrl("  ethereum   ETF & flows  "));

    expect(url.origin + url.pathname).toBe(
      "https://news.google.com/rss/search",
    );
    expect(url.searchParams.get("q")).toBe("ethereum ETF & flows");
    expect(url.searchParams.get("hl")).toBe("en-US");
    expect(url.searchParams.get("gl")).toBe("US");
    expect(url.searchParams.get("ceid")).toBe("US:en");
  });

  it("builds a normalized Bing News fallback URL", () => {
    const url = new URL(buildBingNewsUrl("  Micron   Technology  "));

    expect(url.origin + url.pathname).toBe(
      "https://www.bing.com/news/search",
    );
    expect(url.searchParams.get("q")).toBe("Micron Technology");
    expect(url.searchParams.get("format")).toBe("rss");
    expect(url.searchParams.get("setlang")).toBe("en-US");
  });

  it("falls back to Bing News when Google returns an empty feed", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(
        url.hostname === "news.google.com"
          ? "<rss><channel><title>Google News</title></channel></rss>"
          : `<rss xmlns:News="https://www.bing.com/news/search"><channel>
              <item>
                <title>Fallback story</title>
                <link>https://www.bing.com/news/fallback-story</link>
                <pubDate>Thu, 03 Sep 2026 12:00:00 GMT</pubDate>
                <News:Source>Fallback Publisher</News:Source>
              </item>
            </channel></rss>`,
      );
    }) as NewsFetch;

    const items = await fetchGoogleNewsFeed("Micron", fetchImpl, true);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).hostname).toBe(
      "www.bing.com",
    );
    expect(items).toMatchObject([
      { title: "Fallback story", source: "Fallback Publisher" },
    ]);
  });

  it("keeps the Bing News fallback disabled by default", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        "<rss><channel><title>Google News</title></channel></rss>",
      ),
    ) as NewsFetch;

    const items = await fetchGoogleNewsFeed("Micron", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(items).toEqual([]);
  });

  it("parses, validates, and deduplicates Google News items", () => {
    const items = parseGoogleNewsRss(`
      <rss><channel>
        <item>
          <title>ETF flows &amp; Ethereum</title>
          <link>https://news.google.com/articles/one</link>
          <guid isPermaLink="false">story-one</guid>
          <pubDate>Sun, 30 Aug 2026 21:31:04 GMT</pubDate>
          <source url="https://example.com">Example News</source>
        </item>
        <item>
          <title>Duplicate</title>
          <link>https://news.google.com/articles/duplicate</link>
          <guid>story-one</guid>
        </item>
        <item><title>Missing link</title><guid>bad</guid></item>
        <item>
          <title>Link identity</title>
          <link>https://news.google.com/articles/two</link>
          <pubDate>not-a-date</pubDate>
        </item>
      </channel></rss>
    `);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: hash("story-one"),
      title: "ETF flows & Ethereum",
      link: "https://news.google.com/articles/one",
      source: "Example News",
      publishedAt: "2026-08-30T21:31:04.000Z",
    });
    expect(items[1]).toMatchObject({
      id: hash("https://news.google.com/articles/two"),
      source: "news.google.com",
      publishedAt: null,
    });
  });

  it("blocks redirects from a public feed URL to a private host", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        headers: { Location: "http://127.0.0.1/internal.xml" },
        status: 302,
      }),
    ) as NewsFetch;

    await expect(
      fetchNewsFeed("https://8.8.8.8/feed.xml", fetchImpl),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses standard RSS and Atom feeds with feed-level source fallbacks", () => {
    const rssItems = parseNewsFeed(
      `<rss><channel>
        <title>Example Journal</title>
        <item>
          <title>RSS story</title>
          <link>/stories/rss</link>
          <guid>rss-story</guid>
          <pubDate>Sun, 30 Aug 2026 20:00:00 GMT</pubDate>
        </item>
      </channel></rss>`,
      "https://example.com/feed.xml",
    );
    const atomItems = parseNewsFeed(
      `<feed>
        <title>Example Atom</title>
        <entry>
          <title>Atom story</title>
          <link rel="alternate" href="/stories/atom" />
          <id>atom-story</id>
          <updated>2026-08-30T21:00:00Z</updated>
          <author><name>Atom Author</name></author>
        </entry>
      </feed>`,
      "https://example.com/atom.xml",
    );

    expect(rssItems[0]).toMatchObject({
      link: "https://example.com/stories/rss",
      source: "Example Journal",
      publishedAt: "2026-08-30T20:00:00.000Z",
    });
    expect(atomItems[0]).toMatchObject({
      link: "https://example.com/stories/atom",
      source: "Atom Author",
      publishedAt: "2026-08-30T21:00:00.000Z",
    });
  });

  it("fetches feeds concurrently, deduplicates globally, and keeps partial results", async () => {
    const journalId = new ObjectId();
    const ethereumFeedId = new ObjectId();
    const etfFeedId = new ObjectId();
    const brokenFeedId = new ObjectId();
    const readId = hash("read-story");
    const db = fakeDb({
      _id: journalId,
      newsFeeds: [
        feed(ethereumFeedId, "Ethereum"),
        feed(etfFeedId, "ETF flows"),
        feed(brokenFeedId, "Broken"),
      ],
      newsReadItemIds: [readId],
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("q");
      if (query === "Broken") throw new Error("Feed unavailable.");
      const items =
        query === "Ethereum"
          ? rssItem("shared", "Shared story", "2026-08-30T20:00:00Z") +
            rssItem("read-story", "Read story", "2026-08-30T21:00:00Z")
          : rssItem("newer", "Newer story", "2026-08-30T22:00:00Z") +
            rssItem("shared", "Shared story", "2026-08-30T20:00:00Z");
      return new Response(`<rss><channel>${items}</channel></rss>`);
    }) as NewsFetch;

    const news = await getJournalNews(db, journalId.toString(), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(news?.items.map((item) => item.title)).toEqual([
      "Newer story",
      "Shared story",
    ]);
    expect(news?.items[1].feedKeywords).toEqual(["Ethereum", "ETF flows"]);
    expect(news?.feeds).toMatchObject([
      { keywords: "Ethereum", unreadCount: 1 },
      { keywords: "ETF flows", unreadCount: 2 },
      {
        keywords: "Broken",
        unreadCount: 0,
        error:
          "Google News refresh failed: Feed unavailable. Showing saved results.",
      },
    ]);
  });
});

describe("Google News query cache", () => {
  it("normalizes queries and contacts Google once per 30-minute window", async () => {
    const { db, state } = fakeDbWithState([]);
    const firstAttempt = new Date("2026-09-03T12:00:00Z");
    const item = newsItem("micron-story", "Micron story", firstAttempt);
    const fetchItems = vi
      .fn<() => Promise<ReturnType<typeof newsItem>[]>>()
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([]);

    const first = await getCachedGoogleNews(
      db,
      "  Micron  ",
      new Set(),
      fetchItems,
      { now: firstAttempt },
    );
    const cached = await getCachedGoogleNews(
      db,
      "micron",
      new Set(),
      fetchItems,
      {
        now: new Date(
          firstAttempt.getTime() + JOURNAL_NEWS_CACHE_INTERVAL_MS - 1,
        ),
      },
    );
    const afterWindow = await getCachedGoogleNews(
      db,
      "MICRON",
      new Set(),
      fetchItems,
      {
        now: new Date(
          firstAttempt.getTime() + JOURNAL_NEWS_CACHE_INTERVAL_MS,
        ),
      },
    );

    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(first.items).toEqual([item]);
    expect(cached.items).toEqual([item]);
    expect(afterWindow).toMatchObject({
      items: [item],
      error: "Google News returned no stories; showing saved results.",
    });
    expect(state.queryCaches.size).toBe(1);
    expect(state.articles.size).toBe(1);
    const cache = state.queryCaches.get(getJournalNewsQueryKey("Micron"));
    expect(cache?.lastAttemptAt).toBeInstanceOf(Date);
    expect(cache?.nextAllowedAt).toBeInstanceOf(Date);
    expect(state.articles.get(item.id)?.publishedAt).toBeInstanceOf(Date);
    expect(state.articles.get(item.id)?.firstSeenAt).toBeInstanceOf(Date);
    expect(state.articles.get(item.id)?.lastSeenAt).toBeInstanceOf(Date);
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    const { db } = fakeDbWithState([]);
    let resolveFetch: ((items: ReturnType<typeof newsItem>[]) => void) | null =
      null;
    const fetchItems = vi.fn(
      () =>
        new Promise<ReturnType<typeof newsItem>[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const now = new Date("2026-09-03T12:00:00Z");

    const requests = Promise.all([
      getCachedGoogleNews(db, "Micron", new Set(), fetchItems, { now }),
      getCachedGoogleNews(db, " micron ", new Set(), fetchItems, { now }),
    ]);
    await vi.waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(1));
    resolveFetch?.([newsItem("shared", "Shared story", now)]);
    const results = await requests;

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(results[0].items).toHaveLength(1);
    expect(results[1].items).toEqual(results[0].items);
  });

  it("keeps every article while returning only the newest 500", async () => {
    const { db, state } = fakeDbWithState([]);
    const now = new Date("2026-09-03T12:00:00Z");
    const items = Array.from(
      { length: JOURNAL_NEWS_RESPONSE_LIMIT + 10 },
      (_, index) =>
        newsItem(
          `story-${index}`,
          `Story ${index}`,
          new Date(now.getTime() - index * 1_000),
        ),
    );

    const result = await getCachedGoogleNews(
      db,
      "Data center",
      new Set(),
      async () => items,
      { now },
    );

    expect(state.articles.size).toBe(JOURNAL_NEWS_RESPONSE_LIMIT + 10);
    expect(result.items).toHaveLength(JOURNAL_NEWS_RESPONSE_LIMIT);
    expect(result.items[0].id).toBe(items[0].id);
    expect(result.items.at(-1)?.id).toBe(
      items[JOURNAL_NEWS_RESPONSE_LIMIT - 1].id,
    );
  });

  it("globally deduplicates articles while retaining every query association", async () => {
    const { db, state } = fakeDbWithState([]);
    const now = new Date("2026-09-03T12:00:00Z");
    const item = newsItem("shared-story", "Shared story", now);

    await getCachedGoogleNews(db, "Micron", new Set(), async () => [item], {
      now,
    });
    await getCachedGoogleNews(
      db,
      "Data center",
      new Set(),
      async () => [item],
      { now },
    );

    expect(state.articles.size).toBe(1);
    expect(state.articles.get(item.id)?.queryKeys).toEqual([
      getJournalNewsQueryKey("Micron"),
      getJournalNewsQueryKey("Data center"),
    ]);
  });

  it("serves stored articles with a warning when a later refresh fails", async () => {
    const { db } = fakeDbWithState([]);
    const firstAttempt = new Date("2026-09-03T12:00:00Z");
    const item = newsItem("stored-story", "Stored story", firstAttempt);
    const fetchItems = vi
      .fn<() => Promise<ReturnType<typeof newsItem>[]>>()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("Google unavailable."));

    await getCachedGoogleNews(db, "Micron", new Set(), fetchItems, {
      now: firstAttempt,
    });
    const stale = await getCachedGoogleNews(
      db,
      "Micron",
      new Set(),
      fetchItems,
      {
        now: new Date(
          firstAttempt.getTime() + JOURNAL_NEWS_CACHE_INTERVAL_MS,
        ),
      },
    );

    expect(stale).toEqual({
      items: [item],
      error:
        "Google News refresh failed: Google unavailable. Showing saved results.",
    });
  });
});

describe("journal news persistence", () => {
  it("supports legacy documents and stores normalized feeds with native dates", async () => {
    const journalId = new ObjectId();
    const updatedAt = new Date("2026-08-01T00:00:00Z");
    const store: StoredDocument = { _id: journalId, updatedAt };
    const db = fakeDb(store);
    const emptyFetch = async () =>
      new Response("<rss><channel></channel></rss>");

    const news = await addJournalNewsFeed(
      db,
      journalId.toString(),
      { keywords: "  Ethereum   ETF  " },
      emptyFetch,
    );

    expect(news?.feeds[0]).toMatchObject({
      keywords: "Ethereum ETF",
      unreadCount: 0,
    });
    expect(store.newsFeeds?.[0].createdAt).toBeInstanceOf(Date);
    expect(store.newsFeeds?.[0].normalizedKeywords).toBe("ethereum etf");
    expect(store.updatedAt).toBe(updatedAt);

    await expect(
      addJournalNewsFeed(
        db,
        journalId.toString(),
        { keywords: "ethereum etf" },
        emptyFetch,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("stores and fetches a detected public RSS URL as-is", async () => {
    const journalId = new ObjectId();
    const store: StoredDocument = { _id: journalId };
    const db = fakeDb(store);
    const feedUrl = "https://8.8.8.8/feed.xml?topic=markets";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(feedUrl);
      return new Response(
        `<rss><channel><title>Market Wire</title>${rssItem(
          "market-story",
          "Market story",
          "2026-08-30T22:00:00Z",
        )}</channel></rss>`,
      );
    }) as NewsFetch;

    const news = await addJournalNewsFeed(
      db,
      journalId.toString(),
      { input: `  ${feedUrl}  ` },
      fetchImpl,
    );

    expect(store.newsFeeds?.[0]).toMatchObject({
      kind: "rss",
      url: feedUrl,
      normalizedUrl: feedUrl,
    });
    expect(store.newsFeeds?.[0].createdAt).toBeInstanceOf(Date);
    expect(news?.feeds[0]).toMatchObject({
      kind: "rss",
      keywords: "8.8.8.8/feed.xml",
      url: feedUrl,
      unreadCount: 1,
    });
    expect(news?.items[0].title).toBe("Market story");

    await expect(
      addJournalNewsFeed(
        db,
        journalId.toString(),
        { input: `${feedUrl}#duplicate` },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects RSS URLs that target private network addresses", async () => {
    const journalId = new ObjectId();
    const store: StoredDocument = { _id: journalId };
    const db = fakeDb(store);

    await expect(
      addJournalNewsFeed(db, journalId.toString(), {
        input: "http://127.0.0.1:3000/feed.xml",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(store.newsFeeds).toBeUndefined();
  });

  it("enforces the feed limit and removes a selected feed", async () => {
    const journalId = new ObjectId();
    const feeds = Array.from({ length: JOURNAL_NEWS_FEED_LIMIT }, (_, index) =>
      feed(new ObjectId(), `Feed ${index}`),
    );
    const store: StoredDocument = { _id: journalId, newsFeeds: feeds };
    const db = fakeDb(store);

    await expect(
      addJournalNewsFeed(db, journalId.toString(), { keywords: "One more" }),
    ).rejects.toBeInstanceOf(JournalNewsHttpError);

    expect(
      await removeJournalNewsFeed(
        db,
        journalId.toString(),
        feeds[0]._id.toString(),
      ),
    ).toBe(true);
    expect(store.newsFeeds).toHaveLength(JOURNAL_NEWS_FEED_LIMIT - 1);
  });

  it("stores permanent read receipts without growing legacy read identifiers", async () => {
    const journalId = new ObjectId();
    const existingIds = Array.from(
      { length: JOURNAL_NEWS_READ_LIMIT },
      (_, index) => index.toString(16).padStart(64, "0"),
    );
    const store: StoredDocument = { _id: journalId, newsReadItemIds: existingIds };
    const { db, state } = fakeDbWithState([store]);
    const newItemId = "f".repeat(64);

    expect(
      await markJournalNewsItemRead(db, journalId.toString(), { itemId: newItemId }),
    ).toBe(true);
    expect(
      await markJournalNewsItemRead(db, journalId.toString(), { itemId: newItemId }),
    ).toBe(true);

    expect(store.newsReadItemIds).toEqual(existingIds);
    expect([...state.readReceipts.values()]).toMatchObject([
      { journalId, itemId: newItemId },
    ]);
    expect([...state.readReceipts.values()][0].readAt).toBeInstanceOf(Date);
  });

  it("marks a deduplicated batch of items as read", async () => {
    const journalId = new ObjectId();
    const firstItemId = "a".repeat(64);
    const secondItemId = "b".repeat(64);
    const store: StoredDocument = { _id: journalId, newsReadItemIds: [] };
    const { db, state } = fakeDbWithState([store]);

    expect(
      await markJournalNewsItemsRead(db, journalId.toString(), {
        itemIds: [firstItemId, secondItemId, firstItemId],
      }),
    ).toBe(true);
    expect([...state.readReceipts.values()].map(({ itemId }) => itemId)).toEqual([
      firstItemId,
      secondItemId,
    ]);
    expect(store.newsReadItemIds).toEqual([]);
  });

  it("excludes permanently read cached stories on later requests", async () => {
    const journalId = new ObjectId();
    const storyId = hash("permanent-read-story");
    const store: StoredDocument = {
      _id: journalId,
      newsFeeds: [feed(new ObjectId(), "Micron")],
    };
    const { db } = fakeDbWithState([store]);
    const fetchImpl = vi.fn(async () =>
      new Response(
        `<rss><channel>${rssItem(
          "permanent-read-story",
          "Permanent read story",
          "2026-09-03T12:00:00Z",
        )}</channel></rss>`,
      ),
    ) as NewsFetch;

    expect(
      (await getJournalNews(db, journalId.toString(), fetchImpl))?.items,
    ).toHaveLength(1);
    expect(
      await markJournalNewsItemRead(db, journalId.toString(), {
        itemId: storyId,
      }),
    ).toBe(true);
    expect(
      (await getJournalNews(db, journalId.toString(), fetchImpl))?.items,
    ).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps a journal response at the newest 500 deduplicated stories", async () => {
    const journalId = new ObjectId();
    const store: StoredDocument = {
      _id: journalId,
      newsFeeds: [
        feed(new ObjectId(), "Micron"),
        feed(new ObjectId(), "Data center"),
      ],
    };
    const { db } = fakeDbWithState([store]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "query";
      const items = Array.from({ length: 300 }, (_, index) =>
        rssItem(
          `${query}-${index}`,
          `${query} story ${index}`,
          new Date(Date.UTC(2026, 8, 3, 12, 0, 0) - index * 1_000).toISOString(),
        ),
      ).join("");
      return new Response(`<rss><channel>${items}</channel></rss>`);
    }) as NewsFetch;

    const news = await getJournalNews(db, journalId.toString(), fetchImpl);

    expect(news?.items).toHaveLength(JOURNAL_NEWS_RESPONSE_LIMIT);
    expect(
      news?.feeds.reduce((total, feed) => total + feed.unreadCount, 0),
    ).toBe(JOURNAL_NEWS_RESPONSE_LIMIT);
  });
});

describe("open journal news", () => {
  it("loads only open-journal documents and keeps each journal snapshot separate", async () => {
    const firstJournalId = new ObjectId();
    const secondJournalId = new ObjectId();
    const documents = [
      {
        _id: firstJournalId,
        title: "Ethereum thesis",
        endDate: null,
        startDate: new Date("2026-08-30T00:00:00Z"),
        newsFeeds: [feed(new ObjectId(), "Ethereum")],
      },
      {
        _id: secondJournalId,
        title: "ETF watch",
        startDate: new Date("2026-08-29T00:00:00Z"),
        newsFeeds: [feed(new ObjectId(), "Broken")],
      },
    ];
    const { db, journalFind } = fakeDbWithState(documents);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("q");
      if (query === "Broken") throw new Error("Feed unavailable.");
      return new Response(
        `<rss><channel>${rssItem(
          "shared",
          "Shared story",
          "2026-08-30T22:00:00Z",
        )}</channel></rss>`,
      );
    }) as NewsFetch;

    const result = await getOpenJournalsNews(db, fetchImpl);

    expect(journalFind).toHaveBeenCalledWith({
      $or: [{ endDate: null }, { endDate: { $exists: false } }],
    });
    expect(result.journals).toHaveLength(2);
    expect(result.journals[0]).toMatchObject({
      id: firstJournalId.toString(),
      title: "Ethereum thesis",
      news: { items: [{ title: "Shared story" }] },
    });
    expect(result.journals[1]).toMatchObject({
      id: secondJournalId.toString(),
      title: "ETF watch",
      news: {
        items: [],
        feeds: [
          {
            keywords: "Broken",
            error:
              "Google News refresh failed: Feed unavailable. Showing saved results.",
          },
        ],
      },
    });
  });
});

type StoredFeed = ReturnType<typeof feed>;

type StoredDocument = {
  _id: ObjectId;
  title?: string;
  startDate?: Date;
  endDate?: Date | null;
  newsFeeds?: StoredFeed[];
  newsReadItemIds?: string[];
  updatedAt?: Date;
};

function fakeDb(document: StoredDocument) {
  return fakeDbWithState([document]).db;
}

type FakeQueryCache = {
  _id: string;
  nextAllowedAt: Date;
  refreshToken?: string;
  [key: string]: unknown;
};

type FakeArticle = {
  _id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: Date | null;
  queryKeys: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type FakeReadReceipt = {
  _id: string;
  journalId: ObjectId;
  itemId: string;
  readAt: Date;
};

type FakeNewsDatabaseState = {
  queryCaches: Map<string, FakeQueryCache>;
  articles: Map<string, FakeArticle>;
  readReceipts: Map<string, FakeReadReceipt>;
};

function fakeDbWithState(documents: StoredDocument[]) {
  const state: FakeNewsDatabaseState = {
    queryCaches: new Map(),
    articles: new Map(),
    readReceipts: new Map(),
  };
  const journalFind = vi.fn(() => ({
    sort: () => ({
      toArray: async () =>
        documents
          .filter((document) => document.endDate == null)
          .sort(
            (left, right) =>
              (right.startDate?.getTime() ?? 0) -
              (left.startDate?.getTime() ?? 0),
          ),
    }),
  }));

  const journalCollection = {
    async findOne(query: { _id: ObjectId }) {
      return (
        documents.find((document) => idsEqual(document._id, query._id)) ?? null
      );
    },
    find: journalFind,
    async updateOne(
      query: { _id: ObjectId; "newsFeeds._id"?: ObjectId },
      update: {
        $push?: { newsFeeds: StoredFeed };
        $pull?: { newsFeeds: { _id: ObjectId } };
      },
    ) {
      const document = documents.find((candidate) =>
        idsEqual(candidate._id, query._id),
      );
      const feedMatches = query["newsFeeds._id"]
        ? document?.newsFeeds?.some((candidate) =>
            idsEqual(candidate._id, query["newsFeeds._id"]),
          )
        : true;
      if (!document || !feedMatches) return { matchedCount: 0 };
      if (update.$push?.newsFeeds) {
        document.newsFeeds = [
          ...(document.newsFeeds ?? []),
          update.$push.newsFeeds,
        ];
      }
      if (update.$pull?.newsFeeds) {
        document.newsFeeds = (document.newsFeeds ?? []).filter(
          (candidate) =>
            !idsEqual(candidate._id, update.$pull?.newsFeeds._id),
        );
      }
      return { matchedCount: 1 };
    },
  };

  const queryCacheCollection = {
    async findOne(query: { _id: string }) {
      return state.queryCaches.get(query._id) ?? null;
    },
    async insertOne(document: FakeQueryCache) {
      if (state.queryCaches.has(document._id)) {
        throw Object.assign(new Error("duplicate key"), { code: 11_000 });
      }
      state.queryCaches.set(document._id, document);
      return { acknowledged: true };
    },
    async updateOne(
      query: {
        _id: string;
        nextAllowedAt?: { $lte: Date };
        refreshToken?: string;
      },
      update: {
        $set?: Partial<FakeQueryCache>;
        $unset?: Record<string, string>;
      },
    ) {
      const document = state.queryCaches.get(query._id);
      const matches =
        document &&
        (!query.nextAllowedAt ||
          document.nextAllowedAt.getTime() <=
            query.nextAllowedAt.$lte.getTime()) &&
        (!query.refreshToken || document.refreshToken === query.refreshToken);
      if (!matches) return { matchedCount: 0 };
      Object.assign(document, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete document[key];
      return { matchedCount: 1 };
    },
  };

  const articleCollection = {
    async createIndex() {
      return "queryKeys_1_publishedAt_-1";
    },
    async bulkWrite(
      operations: Array<{
        updateOne: {
          filter: { _id: string };
          update: {
            $set: Partial<FakeArticle>;
            $setOnInsert: Pick<FakeArticle, "firstSeenAt">;
            $addToSet: { queryKeys: string };
          };
        };
      }>,
    ) {
      for (const { updateOne } of operations) {
        const existing = state.articles.get(updateOne.filter._id);
        const article = existing ?? {
          _id: updateOne.filter._id,
          title: "",
          link: "",
          source: "",
          publishedAt: null,
          queryKeys: [],
          firstSeenAt: updateOne.update.$setOnInsert.firstSeenAt,
          lastSeenAt: updateOne.update.$setOnInsert.firstSeenAt,
        };
        Object.assign(article, updateOne.update.$set);
        if (!article.queryKeys.includes(updateOne.update.$addToSet.queryKeys)) {
          article.queryKeys.push(updateOne.update.$addToSet.queryKeys);
        }
        state.articles.set(article._id, article);
      }
      return { acknowledged: true };
    },
    find(query: {
      queryKeys: string;
      _id?: { $nin: string[] };
    }) {
      let limit = Number.POSITIVE_INFINITY;
      const cursor = {
        sort() {
          return cursor;
        },
        limit(value: number) {
          limit = value;
          return cursor;
        },
        async toArray() {
          return [...state.articles.values()]
            .filter(
              (article) =>
                article.queryKeys.includes(query.queryKeys) &&
                !query._id?.$nin.includes(article._id),
            )
            .sort((left, right) => {
              const timeDifference =
                (right.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
                (left.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
              return timeDifference || left.title.localeCompare(right.title);
            })
            .slice(0, limit);
        },
      };
      return cursor;
    },
  };

  const readReceiptCollection = {
    async createIndex() {
      return "journalId_1_itemId_1";
    },
    find(query: { journalId: ObjectId }) {
      return {
        project() {
          return {
            async toArray() {
              return [...state.readReceipts.values()].filter((receipt) =>
                idsEqual(receipt.journalId, query.journalId),
              );
            },
          };
        },
      };
    },
    async bulkWrite(
      operations: Array<{
        updateOne: {
          filter: { _id: string };
          update: { $set: FakeReadReceipt };
        };
      }>,
    ) {
      for (const { updateOne } of operations) {
        state.readReceipts.set(updateOne.filter._id, {
          _id: updateOne.filter._id,
          ...updateOne.update.$set,
        });
      }
      return { acknowledged: true };
    },
  };

  const db = {
    databaseName: `fake-${new ObjectId().toString()}`,
    collection(name: string) {
      if (name === "journalTrades") return journalCollection;
      if (name === "journalNewsQueryCaches") return queryCacheCollection;
      if (name === "journalNewsArticles") return articleCollection;
      if (name === "journalNewsReadReceipts") return readReceiptCollection;
      throw new Error(`Unexpected collection: ${name}`);
    },
  } as unknown as Db;

  return { db, journalFind, state };
}

function feed(id: ObjectId, keywords: string) {
  return {
    _id: id,
    kind: "google" as const,
    keywords,
    normalizedKeywords: keywords.toLocaleLowerCase(),
    createdAt: new Date("2026-08-30T12:00:00Z"),
  };
}

function newsItem(id: string, title: string, publishedAt: Date) {
  return {
    id,
    title,
    link: `https://news.google.com/articles/${id}`,
    source: "Publisher",
    publishedAt: publishedAt.toISOString(),
  };
}

function rssItem(id: string, title: string, date: string) {
  return `<item>
    <title>${title}</title>
    <link>https://news.google.com/articles/${id}</link>
    <guid>${id}</guid>
    <pubDate>${new Date(date).toUTCString()}</pubDate>
    <source>Publisher</source>
  </item>`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function idsEqual(left: ObjectId | undefined, right: ObjectId | undefined) {
  return Boolean(left && right && left.toString() === right.toString());
}
