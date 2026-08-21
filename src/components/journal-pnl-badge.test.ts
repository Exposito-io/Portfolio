import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  JournalClosingPriceMetric,
  JournalPnlMetric,
  JournalPositionValueMetric,
} from "@/components/journal-pnl-badge";
import type { JournalTradePnlSummary } from "@/lib/types";

const summary: JournalTradePnlSummary = {
  pnlUsd: 25,
  pnlPercent: 5,
  realizedPnlUsd: 25,
  unrealizedPnlUsd: null,
  entryPriceUsd: 100,
  closingPriceUsd: 110,
  positionValueUsd: 0,
  orderCount: 2,
  fillCount: 2,
  notionalUsd: 500,
};

describe("JournalPnlMetric", () => {
  it("shows only total PnL when there is no position", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, { summary }),
    );

    expect(markup).toContain("Total PnL");
    expect(markup).not.toContain("Transactions PnL");
    expect(markup).not.toContain("Unrealized PnL");
  });

  it("shows the full PnL breakdown when a position exists", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, {
        summary: {
          ...summary,
          unrealizedPnlUsd: 10,
          positionValueUsd: 1_000,
        },
      }),
    );

    expect(markup).toContain("Transactions PnL");
    expect(markup).toContain("Unrealized PnL");
    expect(markup).toContain("Total PnL");
  });
});

describe("JournalClosingPriceMetric", () => {
  it("displays the calculated average exit price", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalClosingPriceMetric, { summary }),
    );

    expect(markup).toContain("Avg exit price");
    expect(markup).toContain("$110.00");
  });
});

describe("JournalPositionValueMetric", () => {
  it("hides the portfolio percentage when there is no position", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPositionValueMetric, {
        portfolioInvestmentsUsd: 1_000,
        summary,
      }),
    );

    expect(markup).toContain("Position value");
    expect(markup).toContain("$0.00");
    expect(markup).not.toContain("Of portfolio");
  });

  it("shows the portfolio percentage when a position exists", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPositionValueMetric, {
        portfolioInvestmentsUsd: 1_000,
        summary: { ...summary, positionValueUsd: 100 },
      }),
    );

    expect(markup).toContain("Of portfolio");
    expect(markup).toContain("10.0%");
  });
});
