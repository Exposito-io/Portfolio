// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalLatestNews } from "@/components/journal-latest-news";
import { JournalNews } from "@/components/journal-news";
import { JournalNewsProvider } from "@/components/journal-news-context";
import type { JournalNewsResponse } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JournalLatestNews", () => {
  it("navigates the merged timeline and shares mark-read state with the News tab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <JournalNewsProvider tradeId="trade-1">
        <JournalLatestNews tradeId="trade-1" />
        <JournalNews tradeId="trade-1" />
      </JournalNewsProvider>,
    );

    const carousel = await screen.findByRole("region", { name: "Latest News" });
    expect(
      await within(carousel).findByRole("link", { name: /Newest story/ }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(
      within(carousel).getByRole("button", { name: "Next news story" }),
    );
    expect(
      within(carousel).getByRole("link", { name: /Second story/ }),
    ).toBeInTheDocument();

    await user.click(
      within(carousel).getByRole("button", { name: "Previous news story" }),
    );
    expect(
      within(carousel).getByRole("link", { name: /Newest story/ }),
    ).toBeInTheDocument();

    await user.click(
      within(carousel).getByRole("button", { name: "Mark as read" }),
    );
    expect(
      within(carousel).getByRole("link", { name: /Second story/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Newest story")).not.toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/journal/trades/trade-1/news/read",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      itemId: "a".repeat(64),
    });
  });

  it("restores the current story when marking it read fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Unable to save read state." }, 500),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<JournalLatestNews tradeId="trade-1" />);
    const carousel = await screen.findByRole("region", { name: "Latest News" });
    await within(carousel).findByRole("link", { name: /Newest story/ });

    await user.click(
      within(carousel).getByRole("button", { name: "Mark as read" }),
    );

    expect(
      await within(carousel).findByText("Unable to save read state."),
    ).toBeInTheDocument();
    expect(
      within(carousel).getByRole("link", { name: /Newest story/ }),
    ).toBeInTheDocument();
  });
});

const sampleNews: JournalNewsResponse = {
  feeds: [
    {
      id: "feed-1",
      kind: "google",
      keywords: "Markets",
      createdAt: "2026-08-31T12:00:00.000Z",
      unreadCount: 3,
    },
  ],
  items: [
    newsItem("a", "Newest story", "2026-08-31T15:00:00.000Z"),
    newsItem("b", "Second story", "2026-08-31T14:00:00.000Z"),
    newsItem("c", "Oldest story", "2026-08-31T13:00:00.000Z"),
  ],
  fetchedAt: "2026-08-31T16:00:00.000Z",
};

function newsItem(id: string, title: string, publishedAt: string) {
  return {
    id: id.repeat(64),
    title,
    link: `https://example.com/${id}`,
    source: "Example News",
    publishedAt,
    feedIds: ["feed-1"],
    feedKeywords: ["Markets"],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
