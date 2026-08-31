import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
export const JOURNAL_NEWS_URL_LIMIT = 2_048;
export const JOURNAL_NEWS_READ_LIMIT = 2_000;

const MAX_RSS_BYTES = 2_000_000;
const RSS_TIMEOUT_MS = 10_000;

const feedInputSchema = z
  .object({
    input: z.string().optional(),
    keywords: z.string().optional(),
  })
  .transform(({ input, keywords }) => (input ?? keywords ?? "").trim())
  .pipe(
    z
      .string()
      .min(1, "Search keywords or an RSS URL are required.")
      .max(
        JOURNAL_NEWS_URL_LIMIT,
        `RSS URLs cannot exceed ${JOURNAL_NEWS_URL_LIMIT} characters.`,
      ),
  );

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
  kind?: "google" | "rss";
  keywords?: string;
  normalizedKeywords?: string;
  url?: string;
  normalizedUrl?: string;
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

export function parseNewsFeed(
  xml: string,
  feedUrl = GOOGLE_NEWS_RSS_URL,
): ParsedNewsItem[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const rss = recordValue(parsed.rss);
  const channel = recordValue(rss?.channel);
  const rdf = recordValue(parsed["rdf:RDF"] ?? parsed.RDF);
  const atomFeed = recordValue(parsed.feed ?? parsed["atom:feed"]);
  const rawItems = channel
    ? arrayValue(channel.item)
    : rdf
      ? arrayValue(rdf.item)
      : atomFeed
        ? arrayValue(atomFeed.entry ?? atomFeed["atom:entry"])
        : [];
  if (!channel && !rdf && !atomFeed) {
    throw new Error("The URL did not return a supported RSS or Atom feed.");
  }

  const feedTitle = textValue(
    channel?.title ??
      recordValue(rdf?.channel)?.title ??
      atomFeed?.title ??
      atomFeed?.["atom:title"],
  );
  const seen = new Set<string>();
  const items: ParsedNewsItem[] = [];

  for (const rawItem of rawItems) {
    const item = recordValue(rawItem);
    if (!item) continue;

    const title = textValue(item.title ?? item["atom:title"]);
    const rawLink = feedLinkValue(item.link ?? item["atom:link"]);
    const link = resolveFeedLink(rawLink, feedUrl);
    const guid = textValue(item.guid ?? item.id ?? item["atom:id"]);
    const author = recordValue(item.author ?? item["atom:author"]);
    const source =
      textValue(
        item.source ??
          item["dc:creator"] ??
          author?.name ??
          author?.["atom:name"],
      ) ||
      feedTitle ||
      sourceFromUrl(link);
    if (!title || !link || (!guid && !link)) continue;

    try {
      const articleUrl = new URL(link);
      if (articleUrl.protocol !== "https:" && articleUrl.protocol !== "http:") {
        continue;
      }
    } catch {
      continue;
    }

    const identity = isGoogleNewsFeedUrl(feedUrl) ? guid || link : link || guid;
    const id = createNewsItemId(identity);
    if (seen.has(id)) continue;
    seen.add(id);

    const publishedAt = parsePublishedAt(
      textValue(
        item.pubDate ??
          item.published ??
          item.updated ??
          item["dc:date"] ??
          item["atom:published"] ??
          item["atom:updated"],
      ),
    );
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

export function parseGoogleNewsRss(xml: string): ParsedNewsItem[] {
  return parseNewsFeed(xml, GOOGLE_NEWS_RSS_URL);
}

export async function fetchGoogleNewsFeed(
  keywords: string,
  fetchImpl: NewsFetch = fetch,
) {
  return fetchNewsFeed(buildGoogleNewsUrl(keywords), fetchImpl, false);
}

export async function fetchNewsFeed(
  feedUrl: string,
  fetchImpl: NewsFetch = fetch,
  validatePublicUrl = true,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);

  try {
    let currentUrl = feedUrl;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      if (validatePublicUrl) await assertPublicFeedUrl(currentUrl);

      const response = await fetchImpl(currentUrl, {
        cache: "no-store",
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml;q=0.95, application/xml;q=0.9, text/xml;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("The RSS feed returned an invalid redirect.");
        }
        if (redirectCount === 3) {
          throw new Error("The RSS feed redirected too many times.");
        }
        await response.body?.cancel();
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`The RSS feed returned HTTP ${response.status}.`);
      }

      const xml = await readResponseText(response);
      return parseNewsFeed(xml, currentUrl);
    }

    throw new Error("The RSS feed redirected too many times.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The RSS feed took too long to respond.");
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
      items: feed.url
        ? await fetchNewsFeed(feed.url, fetchImpl)
        : await fetchGoogleNewsFeed(feed.keywords ?? "", fetchImpl),
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

  const input = classifyFeedInput(feedInputSchema.parse(payload));
  const journal = await collection(db).findOne({ _id });
  if (!journal) return null;

  const feeds = journal.newsFeeds ?? [];
  if (feeds.length >= JOURNAL_NEWS_FEED_LIMIT) {
    throw new JournalNewsHttpError(
      `A journal can have at most ${JOURNAL_NEWS_FEED_LIMIT} news feeds.`,
      400,
    );
  }

  let feed: NewsFeedDocument;
  if (input.kind === "rss") {
    if (
      feeds.some(
        (candidate) => candidate.normalizedUrl === input.normalizedUrl,
      )
    ) {
      throw new JournalNewsHttpError("This RSS feed already exists.", 409);
    }
    await assertPublicFeedUrl(input.url);
    feed = {
      _id: new ObjectId(),
      kind: "rss",
      url: input.url,
      normalizedUrl: input.normalizedUrl,
      createdAt: new Date(),
    };
  } else {
    if (
      feeds.some(
        (candidate) =>
          !candidate.url &&
          candidate.normalizedKeywords === input.normalizedKeywords,
      )
    ) {
      throw new JournalNewsHttpError(
        "A feed with these search keywords already exists.",
        409,
      );
    }
    feed = {
      _id: new ObjectId(),
      kind: "google",
      keywords: input.keywords,
      normalizedKeywords: input.normalizedKeywords,
      createdAt: new Date(),
    };
  }

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
    const label = feedLabel(result.feed);
    let unreadCount = 0;

    for (const item of result.items) {
      if (readIds.has(item.id)) continue;
      unreadCount += 1;

      const existing = itemsById.get(item.id);
      if (existing) {
        if (!existing.feedIds.includes(feedId)) {
          existing.feedIds.push(feedId);
          existing.feedKeywords.push(label);
        }
        continue;
      }

      itemsById.set(item.id, {
        ...item,
        feedIds: [feedId],
        feedKeywords: [label],
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
    keywords: feedLabel(feed),
    kind: feed.url ? "rss" : "google",
    ...(feed.url ? { url: feed.url } : {}),
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

function classifyFeedInput(value: string) {
  if (/^https?:\/\//i.test(value)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new JournalNewsHttpError("Enter a valid RSS URL.", 400);
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new JournalNewsHttpError(
        "RSS URLs cannot contain credentials.",
        400,
      );
    }
    parsedUrl.hash = "";
    return {
      kind: "rss" as const,
      url: value,
      normalizedUrl: parsedUrl.toString(),
    };
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    throw new JournalNewsHttpError(
      "RSS feeds must use an HTTP or HTTPS URL.",
      400,
    );
  }

  const keywords = normalizeKeywords(value);
  if (keywords.length > JOURNAL_NEWS_KEYWORDS_LIMIT) {
    throw new JournalNewsHttpError(
      `Search keywords cannot exceed ${JOURNAL_NEWS_KEYWORDS_LIMIT} characters.`,
      400,
    );
  }
  return {
    kind: "google" as const,
    keywords,
    normalizedKeywords: keywords.toLocaleLowerCase(),
  };
}

function normalizeKeywords(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function feedLabel(feed: NewsFeedDocument) {
  if (feed.keywords) return feed.keywords;
  if (!feed.url) return "RSS feed";
  try {
    const url = new URL(feed.url);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return feed.url;
  }
}

function feedLinkValue(value: unknown) {
  for (const candidate of arrayValue(value)) {
    if (typeof candidate === "string") return candidate.trim();
    const record = recordValue(candidate);
    if (!record) continue;
    const href = textValue(record["@_href"] ?? record.href);
    const rel = textValue(record["@_rel"] ?? record.rel);
    if (href && (!rel || rel === "alternate")) return href;
  }
  return textValue(value);
}

function resolveFeedLink(value: string, feedUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, feedUrl).toString();
  } catch {
    return "";
  }
}

function sourceFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "Unknown source";
  } catch {
    return "Unknown source";
  }
}

function isGoogleNewsFeedUrl(value: string) {
  try {
    return new URL(value).hostname === "news.google.com";
  } catch {
    return false;
  }
}

async function readResponseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RSS_BYTES) {
    throw new Error("The RSS feed is unexpectedly large.");
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RSS_BYTES) {
      throw new Error("The RSS feed is unexpectedly large.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RSS_BYTES) {
      await reader.cancel();
      throw new Error("The RSS feed is unexpectedly large.");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function assertPublicFeedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new JournalNewsHttpError("Enter a valid RSS URL.", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new JournalNewsHttpError(
      "RSS feeds must use an HTTP or HTTPS URL.",
      400,
    );
  }
  if (url.username || url.password) {
    throw new JournalNewsHttpError(
      "RSS URLs cannot contain credentials.",
      400,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new JournalNewsHttpError("RSS URLs must use a public host.", 400);
  }

  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true, verbatim: true })).map(
          ({ address }) => address,
        );
  } catch {
    throw new JournalNewsHttpError(
      "The RSS feed host could not be resolved.",
      400,
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicIp(address))
  ) {
    throw new JournalNewsHttpError("RSS URLs must use a public host.", 400);
  }
}

function isPublicIp(address: string) {
  const normalized = address.toLocaleLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isPublicIpv4(address: string) {
  const [first, second, third] = address.split(".").map(Number);
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
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
