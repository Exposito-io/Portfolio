// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JournalEntryDialog,
  type JournalEntryFormState,
} from "@/components/journal-entry-dialog";
import type { JournalTrade } from "@/lib/types";

afterEach(cleanup);

const trade: JournalTrade = {
  id: "trade-1",
  kind: "trade",
  direction: "long",
  title: "ETH long",
  descriptionMarkdown: "",
  metricsMarkdown: "",
  metricsEmbeds: [],
  startDate: "2026-10-01T09:30",
  endDate: null,
  asset: {
    kind: "perp",
    label: "ETH perp",
    coin: "ETH",
    chartCoin: "ETH",
  },
  tradingViewCharts: [],
  entries: [],
  createdAt: "2026-10-01T14:30:00.000Z",
  updatedAt: "2026-10-01T14:30:00.000Z",
};

const form: JournalEntryFormState = {
  date: "2026-10-09T12:00",
  tags: ["post-mortem"],
  descriptionMarkdown: "",
};

describe("JournalEntryDialog", () => {
  it("sets the close date to the latest transaction date", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <JournalEntryDialog
        trade={trade}
        closingTrade
        editingEntry={null}
        error=""
        form={form}
        lastTransactionDate="2026-10-08T15:42"
        saving={false}
        tagSuggestions={[]}
        onChange={onChange}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use last transaction date" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      ...form,
      date: "2026-10-08T15:42",
    });
  });

  it("only shows the shortcut while closing a trade with a transaction date", () => {
    const { rerender } = render(
      <JournalEntryDialog
        trade={trade}
        closingTrade
        editingEntry={null}
        error=""
        form={form}
        lastTransactionDate={null}
        saving={false}
        tagSuggestions={[]}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Use last transaction date" }),
    ).not.toBeInTheDocument();

    rerender(
      <JournalEntryDialog
        trade={trade}
        closingTrade={false}
        editingEntry={null}
        error=""
        form={form}
        lastTransactionDate="2026-10-08T15:42"
        saving={false}
        tagSuggestions={[]}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Use last transaction date" }),
    ).not.toBeInTheDocument();
  });
});
