// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalDetailTabs } from "@/components/journal-detail-tabs";
import { JournalNews } from "@/components/journal-news";
import type { JournalNewsResponse } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JournalDetailTabs news loading", () => {
  it("mounts News only when first selected and preserves it across tabs", async () => {
    const mounted = vi.fn();

    function NewsProbe() {
      useEffect(() => mounted(), []);
      return <div>News reader</div>;
    }

    const user = userEvent.setup();
    render(
      <JournalDetailTabs
        charts={<div>Charts panel</div>}
        journal={<div>Journal panel</div>}
        news={<NewsProbe />}
        transactions={<div>Transactions panel</div>}
      />,
    );

    expect(screen.queryByText("News reader")).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "News" }));
    expect(screen.getByText("News reader")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Charts" }));
    await user.click(screen.getByRole("tab", { name: "News" }));
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe("JournalNews", () => {
  it("loads the merged timeline, filters by feed, and marks a story read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<JournalNews tradeId="trade-1" />);

    expect(await screen.findByText("Shared story")).toBeInTheDocument();
    expect(screen.getByText("Ethereum-only story")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ETF flows 1/i }));
    expect(screen.getByText("Shared story")).toBeInTheDocument();
    expect(screen.queryByText("Ethereum-only story")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark as read/i }));
    expect(screen.queryByText("Shared story")).not.toBeInTheDocument();
    expect(screen.getByText("You’re caught up")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/journal/trades/trade-1/news/read",
    );
  });

  it("restores an optimistically removed story when marking it read fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Could not save read state." }, 500),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<JournalNews tradeId="trade-1" />);
    const story = await screen.findByText("Shared story");
    const storyRow = story.closest("li");
    expect(storyRow).not.toBeNull();

    await user.click(
      screen.getAllByRole("button", { name: /mark as read/i })[0],
    );

    expect(
      await screen.findByText("Could not save read state."),
    ).toBeInTheDocument();
    expect(screen.getByText("Shared story")).toBeInTheDocument();
  });

  it("adds, refreshes, and removes keyword feeds without reloading the page", async () => {
    const addedNews: JournalNewsResponse = {
      ...sampleNews,
      feeds: [
        ...sampleNews.feeds,
        {
          id: "feed-sol",
          keywords: "Solana",
          createdAt: "2026-08-30T12:00:00.000Z",
          unreadCount: 0,
        },
      ],
    };
    let newsGetCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/news/feeds")) {
        return jsonResponse({ news: addedNews }, 201);
      }
      if (init?.method === "DELETE") return jsonResponse({ ok: true });
      if (url.endsWith("/news")) {
        const responseNews = newsGetCount === 0 ? sampleNews : addedNews;
        newsGetCount += 1;
        return jsonResponse({ news: responseNews });
      }
      return jsonResponse({ news: addedNews });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<JournalNews tradeId="trade-1" />);
    await screen.findByText("Shared story");

    await user.type(screen.getByLabelText("Search keywords"), "Solana");
    await user.click(screen.getByRole("button", { name: "Add feed" }));
    expect(
      await screen.findByRole("button", { name: /Solana 0/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/news")),
      ).toHaveLength(2),
    );

    await user.click(screen.getByRole("button", { name: "Remove Solana feed" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Solana 0/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows empty and partial-feed failure states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          news: {
            feeds: [
              {
                id: "feed-broken",
                keywords: "Broken feed",
                createdAt: "2026-08-30T12:00:00.000Z",
                unreadCount: 0,
                error: "Feed unavailable.",
              },
            ],
            items: [],
            fetchedAt: "2026-08-30T22:00:00.000Z",
          },
        }),
      ),
    );

    render(<JournalNews tradeId="trade-1" />);

    expect(
      await screen.findByText(
        /^Some feeds could not be refreshed:\s*Broken feed\.$/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("You’re caught up")).toBeInTheDocument();
  });
});

const sampleNews: JournalNewsResponse = {
  feeds: [
    {
      id: "feed-eth",
      keywords: "Ethereum",
      createdAt: "2026-08-30T12:00:00.000Z",
      unreadCount: 2,
    },
    {
      id: "feed-etf",
      keywords: "ETF flows",
      createdAt: "2026-08-30T12:00:00.000Z",
      unreadCount: 1,
    },
  ],
  items: [
    {
      id: "a".repeat(64),
      title: "Shared story",
      link: "https://news.google.com/articles/shared",
      source: "Example News",
      publishedAt: "2026-08-30T21:00:00.000Z",
      feedIds: ["feed-eth", "feed-etf"],
      feedKeywords: ["Ethereum", "ETF flows"],
    },
    {
      id: "b".repeat(64),
      title: "Ethereum-only story",
      link: "https://news.google.com/articles/eth",
      source: "Another Publisher",
      publishedAt: "2026-08-30T20:00:00.000Z",
      feedIds: ["feed-eth"],
      feedKeywords: ["Ethereum"],
    },
  ],
  fetchedAt: "2026-08-30T22:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
