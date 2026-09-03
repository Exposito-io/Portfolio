// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenJournalNewsReader } from "@/components/open-journal-news-reader";
import type { OpenJournalNewsResponse } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpenJournalNewsReader", () => {
  it("deduplicates the All view and filters by journal tabs and feeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ news: sampleNews })));
    const user = userEvent.setup();
    render(<OpenJournalNewsReader />);

    expect(await screen.findByText("Shared story")).toBeInTheDocument();
    expect(screen.getAllByText("Shared story")).toHaveLength(1);
    expect(screen.getByText("Bitcoin-only story")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "All feeds 2" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Ethereum thesis 1" }));
    expect(screen.getByText("Shared story")).toBeInTheDocument();
    expect(screen.queryByText("Bitcoin-only story")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All feeds 1" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Bitcoin trade 2" }));
    await user.click(screen.getByRole("button", { name: "Macro 1" }));
    expect(screen.getByText("Shared story")).toBeInTheDocument();
    expect(screen.queryByText("Bitcoin-only story")).not.toBeInTheDocument();
  });

  it("marks a deduplicated story read in every matching journal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenJournalNewsReader />);

    const story = await screen.findByText("Shared story");
    const storyRow = story.closest("li");
    expect(storyRow).not.toBeNull();
    await user.click(
      within(storyRow as HTMLLIElement).getByRole("button", {
        name: "Mark as read",
      }),
    );

    await waitFor(() => expect(screen.queryByText("Shared story")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      "/api/journal/trades/journal-eth/news/read",
      "/api/journal/trades/journal-btc/news/read",
    ]);
  });

  it("restores only the journal association whose read request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "Save failed." }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenJournalNewsReader />);

    const story = await screen.findByText("Shared story");
    await user.click(
      within(story.closest("li") as HTMLLIElement).getByRole("button", {
        name: "Mark as read",
      }),
    );

    expect(
      await screen.findByText(
        "The story was marked read in some journals, but not all of them.",
      ),
    ).toBeInTheDocument();
    const restoredStory = screen.getByText("Shared story");
    const restoredRow = restoredStory.closest("li");
    expect(within(restoredRow as HTMLLIElement).getByText("Bitcoin trade")).toBeInTheDocument();
    expect(within(restoredRow as HTMLLIElement).queryByText("Ethereum thesis")).not.toBeInTheDocument();
  });

  it("marks the selected age range read across matching journals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ news: sampleNews }))
      .mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<OpenJournalNewsReader />);

    await screen.findByText("Shared story");
    await user.click(screen.getAllByRole("button", { name: "Mark as read" })[0]);
    await user.click(
      screen.getByRole("menuitem", { name: "Older than 1 day" }),
    );

    expect(await screen.findByText("You’re caught up")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.slice(1).map(([url, request]) => [
      url,
      JSON.parse(request.body),
    ])).toEqual([
      [
        "/api/journal/trades/journal-eth/news/read-all",
        { itemIds: ["a".repeat(64)] },
      ],
      [
        "/api/journal/trades/journal-btc/news/read-all",
        { itemIds: ["a".repeat(64), "b".repeat(64)] },
      ],
    ]);
  });

  it("refreshes manually and supports arrow-key journal tab navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ news: sampleNews }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OpenJournalNewsReader />);

    const allTab = await screen.findByRole("tab", { name: "All 2" });
    const refreshButton = screen.getByRole("button", { name: "Refresh news" });
    expect(refreshButton.textContent).toBe("");
    expect(
      screen.queryByText("Unread stories from all your open journals."),
    ).not.toBeInTheDocument();
    allTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Ethereum thesis 1" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Ethereum thesis 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(refreshButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

const sharedItem = {
  id: "a".repeat(64),
  title: "Shared story",
  link: "https://example.com/shared",
  source: "Example News",
  publishedAt: "2026-08-30T22:00:00.000Z",
};

const sampleNews: OpenJournalNewsResponse = {
  fetchedAt: "2026-08-30T23:00:00.000Z",
  journals: [
    {
      id: "journal-eth",
      title: "Ethereum thesis",
      news: {
        fetchedAt: "2026-08-30T23:00:00.000Z",
        feeds: [
          {
            id: "feed-eth",
            kind: "google",
            keywords: "Ethereum",
            createdAt: "2026-08-30T12:00:00.000Z",
            unreadCount: 1,
          },
        ],
        items: [
          {
            ...sharedItem,
            feedIds: ["feed-eth"],
            feedKeywords: ["Ethereum"],
          },
        ],
      },
    },
    {
      id: "journal-btc",
      title: "Bitcoin trade",
      news: {
        fetchedAt: "2026-08-30T23:00:00.000Z",
        feeds: [
          {
            id: "feed-btc",
            kind: "google",
            keywords: "Bitcoin",
            createdAt: "2026-08-30T12:00:00.000Z",
            unreadCount: 2,
          },
          {
            id: "feed-macro",
            kind: "google",
            keywords: "Macro",
            createdAt: "2026-08-30T12:00:00.000Z",
            unreadCount: 1,
          },
        ],
        items: [
          {
            ...sharedItem,
            feedIds: ["feed-macro"],
            feedKeywords: ["Macro"],
          },
          {
            id: "b".repeat(64),
            title: "Bitcoin-only story",
            link: "https://example.com/bitcoin",
            source: "Market Wire",
            publishedAt: "2026-08-30T21:00:00.000Z",
            feedIds: ["feed-btc"],
            feedKeywords: ["Bitcoin"],
          },
        ],
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
