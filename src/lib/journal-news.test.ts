import { createHash } from "node:crypto";

import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import {
  addJournalNewsFeed,
  buildGoogleNewsUrl,
  fetchNewsFeed,
  getJournalNews,
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

describe("Google News RSS", () => {
  it("encodes normalized keywords into the fixed Google News URL", () => {
    const url = new URL(buildGoogleNewsUrl("  ethereum   ETF & flows  "));

    expect(url.origin + url.pathname).toBe(
      "https://news.google.com/rss/search",
    );
    expect(url.searchParams.get("q")).toBe("ethereum ETF & flows");
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
      { keywords: "Broken", unreadCount: 0, error: "Feed unavailable." },
    ]);
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

  it("marks items idempotently and caps retained read identifiers", async () => {
    const journalId = new ObjectId();
    const existingIds = Array.from(
      { length: JOURNAL_NEWS_READ_LIMIT },
      (_, index) => index.toString(16).padStart(64, "0"),
    );
    const store: StoredDocument = { _id: journalId, newsReadItemIds: existingIds };
    const db = fakeDb(store);
    const newItemId = "f".repeat(64);

    expect(
      await markJournalNewsItemRead(db, journalId.toString(), { itemId: newItemId }),
    ).toBe(true);
    expect(
      await markJournalNewsItemRead(db, journalId.toString(), { itemId: newItemId }),
    ).toBe(true);

    expect(store.newsReadItemIds).toHaveLength(JOURNAL_NEWS_READ_LIMIT);
    expect(store.newsReadItemIds[0]).toBe(existingIds[1]);
    expect(store.newsReadItemIds.at(-1)).toBe(newItemId);
    expect(store.newsReadItemIds.filter((id) => id === newItemId)).toHaveLength(1);
  });

  it("marks a deduplicated batch of items as read", async () => {
    const journalId = new ObjectId();
    const firstItemId = "a".repeat(64);
    const secondItemId = "b".repeat(64);
    const store: StoredDocument = { _id: journalId, newsReadItemIds: [] };
    const db = fakeDb(store);

    expect(
      await markJournalNewsItemsRead(db, journalId.toString(), {
        itemIds: [firstItemId, secondItemId, firstItemId],
      }),
    ).toBe(true);
    expect(store.newsReadItemIds).toEqual([firstItemId, secondItemId]);
  });
});

type StoredFeed = ReturnType<typeof feed>;

type StoredDocument = {
  _id: ObjectId;
  newsFeeds?: StoredFeed[];
  newsReadItemIds?: string[];
  updatedAt?: Date;
};

function fakeDb(document: StoredDocument) {
  const collection = {
    async findOne(query: { _id: ObjectId }) {
      return idsEqual(document._id, query._id) ? document : null;
    },
    async updateOne(
      query: { _id: ObjectId; "newsFeeds._id"?: ObjectId },
      update: {
        $push?: { newsFeeds: StoredFeed };
        $pull?: { newsFeeds: { _id: ObjectId } };
        $set?: { newsReadItemIds: string[] };
      },
    ) {
      const feedMatches = query["newsFeeds._id"]
        ? document.newsFeeds?.some((candidate) =>
            idsEqual(candidate._id, query["newsFeeds._id"]),
          )
        : true;
      if (!idsEqual(document._id, query._id) || !feedMatches) {
        return { matchedCount: 0 };
      }
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
      if (update.$set?.newsReadItemIds) {
        document.newsReadItemIds = update.$set.newsReadItemIds;
      }
      return { matchedCount: 1 };
    },
  };

  return {
    collection: () => collection,
  } as unknown as Db;
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
