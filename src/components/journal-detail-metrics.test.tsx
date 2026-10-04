// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalDetailMetrics } from "@/components/journal-detail-metrics";
import type { JournalMetricEmbed, JournalTrade } from "@/lib/types";

afterEach(cleanup);

const trade = {
  id: "trade-1",
  kind: "trade",
  direction: "long",
  title: "ETH setup",
  descriptionMarkdown: "",
  metricsMarkdown: "- [Funding](https://example.com)\n- OI: 12k",
  metricsEmbeds: [],
  startDate: "2026-07-01T00:00:00.000Z",
  endDate: null,
  asset: { kind: "perp", label: "ETH perp", coin: "ETH", chartCoin: "ETH" },
  tradingViewCharts: [],
  entries: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} satisfies JournalTrade;

describe("JournalDetailMetrics", () => {
  it("renders the saved metrics markdown with links", () => {
    render(
      <JournalDetailMetrics saving={false} trade={trade} onSave={vi.fn()} />,
    );

    expect(
      screen.getByRole("link", { name: "Funding" }),
    ).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText("OI: 12k")).toBeInTheDocument();
  });

  it("shows an empty message when no metrics are saved", () => {
    render(
      <JournalDetailMetrics
        saving={false}
        trade={{ ...trade, metricsMarkdown: "" }}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("No metrics yet.")).toBeInTheDocument();
  });

  it("edits the metrics markdown and saves it", async () => {
    const onSave = vi
      .fn<
        (
          metricsMarkdown: string,
          metricsEmbeds: JournalMetricEmbed[],
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <JournalDetailMetrics saving={false} trade={trade} onSave={onSave} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit metrics" }));
    const editor = screen.getByRole("textbox", { name: "Metrics" });
    expect(editor).toHaveValue("- [Funding](https://example.com)\n- OI: 12k");

    await user.clear(editor);
    fireEvent.change(editor, {
      target: { value: "- [CVD](https://example.com/cvd)" },
    });
    await user.click(screen.getByRole("button", { name: "Save metrics" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        "- [CVD](https://example.com/cvd)",
        [],
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Metrics" })).toBeNull(),
    );
  });

  it("keeps editing when saving fails", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Unable to save metrics.");
    });
    const user = userEvent.setup();
    render(
      <JournalDetailMetrics saving={false} trade={trade} onSave={onSave} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit metrics" }));
    await user.click(screen.getByRole("button", { name: "Save metrics" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(
      screen.getByRole("textbox", { name: "Metrics" }),
    ).toBeInTheDocument();
  });

  it("adds a named DefiLlama chart from the Add metric dialog", async () => {
    const onSave = vi
      .fn<
        (
          metricsMarkdown: string,
          metricsEmbeds: JournalMetricEmbed[],
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <JournalDetailMetrics saving={false} trade={trade} onSave={onSave} />,
    );

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(
      screen.getByRole("menuitem", { name: /DefiLlama chart/i }),
    );
    const dialog = screen.getByRole("dialog", { name: "DefiLlama chart" });
    await user.type(
      within(dialog).getByRole("textbox", { name: /Chart name/i }),
      "My Ethereum TVL",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Chart URL or iframe code" }),
      '<iframe title="Ethereum TVL" src="https://defillama.com/chart/chain/Ethereum?foo=1&amp;bar=2"></iframe>',
    );
    await user.click(within(dialog).getByRole("button", { name: "Add chart" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toBe(trade.metricsMarkdown);
    const embeds = onSave.mock.calls[0][1];
    expect(embeds).toEqual([
      expect.objectContaining({
        provider: "defillama",
        name: "My Ethereum TVL",
        url: "https://defillama.com/chart/chain/Ethereum?foo=1&bar=2",
      }),
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "DefiLlama chart" })).toBeNull(),
    );
  });

  it("renders a saved DefiLlama chart", () => {
    render(
      <JournalDetailMetrics
        saving={false}
        trade={{
          ...trade,
          metricsEmbeds: [
            {
              id: "embed-1",
              provider: "defillama",
              name: "Ethereum TVL",
              url: "https://defillama.com/chart/chain/Ethereum",
            },
          ],
        }}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Ethereum TVL")).toHaveAttribute(
      "src",
      "https://defillama.com/chart/chain/Ethereum",
    );
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "href",
      "https://defillama.com/chart/chain/Ethereum",
    );
  });

  it("rejects iframe URLs outside DefiLlama", async () => {
    const user = userEvent.setup();
    render(
      <JournalDetailMetrics saving={false} trade={trade} onSave={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(
      screen.getByRole("menuitem", { name: /DefiLlama chart/i }),
    );
    const dialog = screen.getByRole("dialog", { name: "DefiLlama chart" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Chart URL or iframe code" }),
      '<iframe src="https://example.com/chart"></iframe>',
    );
    await user.click(within(dialog).getByRole("button", { name: "Add chart" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Use an HTTPS URL hosted by defillama.com.",
    );
  });
});
