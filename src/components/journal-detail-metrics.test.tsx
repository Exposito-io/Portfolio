// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalDetailMetrics } from "@/components/journal-detail-metrics";
import type { JournalTrade } from "@/lib/types";

afterEach(cleanup);

const trade = {
  id: "trade-1",
  kind: "trade",
  direction: "long",
  title: "ETH setup",
  descriptionMarkdown: "",
  metricsMarkdown: "- [Funding](https://example.com)\n- OI: 12k",
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
    const onSave = vi.fn(async () => undefined);
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
      expect(onSave).toHaveBeenCalledWith("- [CVD](https://example.com/cvd)"),
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
});
