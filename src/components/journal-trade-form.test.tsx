// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalTradeForm } from "@/components/journal-trade-form";
import { getJournalAssetKey } from "@/lib/journal-market-options";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        settings: {
          journalDescriptionTemplates: [
            { id: "setup", title: "Setup", descriptionMarkdown: "## Setup" },
            { id: "review", title: "Review", descriptionMarkdown: "## Review" },
          ],
        },
      }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const market = {
  kind: "perp" as const,
  label: "ETH perp",
  coin: "ETH",
  chartCoin: "ETH",
};

describe("JournalTradeForm", () => {
  it("shows open-position tickers before the other markets", () => {
    const btc = {
      kind: "perp" as const,
      label: "BTC perp",
      coin: "BTC",
      chartCoin: "BTC",
    };
    const sol = {
      kind: "perp" as const,
      label: "SOL perp",
      coin: "SOL",
      chartCoin: "SOL",
    };

    render(
      <JournalTradeForm
        markets={[btc, market, sol]}
        openPositionMarketKeys={[
          getJournalAssetKey(market),
          getJournalAssetKey(sol),
        ]}
        saving={false}
        submitLabel="Add item"
        onSubmit={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("Ticker / Hyperliquid asset");
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map((group) => group.label)).toEqual([
      "Open positions",
      "Other markets",
    ]);
    expect(
      groups.map((group) =>
        Array.from(group.querySelectorAll("option"), (option) => option.textContent),
      ),
    ).toEqual([["ETH perp", "SOL perp"], ["BTC perp"]]);
  });

  it("allows writing when templates are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Templates unavailable." }),
      })),
    );
    const user = userEvent.setup();
    render(
      <JournalTradeForm
        markets={[market]}
        saving={false}
        submitLabel="Add item"
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByText(
      "Templates unavailable. You can still write your description.",
    );
    await user.type(screen.getByLabelText("Description"), "Independent draft");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Independent draft",
    );
    expect(screen.getByLabelText("Description template")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Insert template" }),
    ).not.toBeInTheDocument();
  });

  it("prevents insertion beyond the journal description limit without truncating text", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        settings: {
          journalDescriptionTemplates: [
            {
              id: "oversized",
              title: "Oversized",
              descriptionMarkdown: "x".repeat(12_001),
            },
          ],
        },
      }),
    } as Response);
    render(
      <JournalTradeForm
        markets={[market]}
        saving={false}
        submitLabel="Add item"
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Oversized" });
    await user.selectOptions(
      screen.getByLabelText("Description template"),
      "oversized",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "12,000-character description limit",
    );
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("inserts immediately and confirms before replacing a non-empty description", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(
      <JournalTradeForm
        markets={[market]}
        saving={false}
        submitLabel="Add item"
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole("option", { name: "Setup" });
    const description = screen.getByLabelText("Description");
    expect(description).toHaveValue("");

    await user.selectOptions(
      screen.getByLabelText("Description template"),
      "setup",
    );
    expect(description).toHaveValue("## Setup");
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Description template")).toHaveValue("");

    await user.clear(description);
    await user.type(description, "My own notes");
    await user.selectOptions(
      screen.getByLabelText("Description template"),
      "setup",
    );
    expect(description).toHaveValue("My own notes");
    expect(confirm).toHaveBeenCalledWith(
      "Replace your current description with this template? Your current description will be lost.",
    );
    expect(screen.getByLabelText("Description template")).toHaveValue("");

    confirm.mockReturnValue(true);
    await user.selectOptions(
      screen.getByLabelText("Description template"),
      "review",
    );
    expect(description).toHaveValue("## Review");
    expect(screen.getByLabelText("Description template")).toHaveValue("");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Title"), "Review trade");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptionMarkdown: "## Review",
      }),
    );
  });

  it("autosaves a template after the user confirms replacing a saved description", async () => {
    const user = userEvent.setup();
    const onAutoSaveDescription = vi.fn(async () => undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const trade = {
      id: "one",
      kind: "trade",
      direction: "long",
      title: "Saved trade",
      descriptionMarkdown: "Original text",
      startDate: "2026-09-14T12:00:00Z",
      endDate: null,
      asset: market,
    } as import("@/lib/types").JournalTrade;
    render(
      <JournalTradeForm
        trade={trade}
        markets={[market]}
        saving={false}
        submitLabel="Save trade"
        onSubmit={vi.fn()}
        onAutoSaveDescription={onAutoSaveDescription}
        autoSaveIntervalMs={20}
      />,
    );
    await screen.findByRole("option", { name: "Setup" });
    await user.selectOptions(
      screen.getByLabelText("Description template"),
      "setup",
    );
    expect(screen.getByLabelText("Description")).toHaveValue("## Setup");
    await waitFor(() =>
      expect(onAutoSaveDescription).toHaveBeenCalledWith("## Setup"),
    );
  });

  it("keeps direction available and submits it for trade ideas", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);

    render(
      <JournalTradeForm
        markets={[market]}
        saving={false}
        submitLabel="Add item"
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: "This is a trade idea" }),
    );

    const longDirection = screen.getByRole("radio", { name: "long" });
    const shortDirection = screen.getByRole("radio", { name: "short" });
    expect(longDirection).toBeVisible();
    expect(shortDirection).toBeVisible();

    await user.click(shortDirection);
    await user.type(screen.getByLabelText("Title"), "ETH breakdown idea");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "idea",
          direction: "short",
          title: "ETH breakdown idea",
          asset: market,
        }),
      ),
    );
  });
});
