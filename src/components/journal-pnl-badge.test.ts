import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  JournalClosingPriceMetric,
  JournalFundingMetric,
  JournalMarketMetric,
  JournalPnlMetric,
  JournalPositionValueMetric,
  getFundingRateTone,
} from "@/components/journal-pnl-badge";
import type { JournalTradePnlSummary } from "@/lib/types";

const summary: JournalTradePnlSummary = {
  pnlUsd: 25,
  pnlPercent: 5,
  realizedPnlUsd: 25,
  realizedPnlPercent: 5,
  realizedPnlBasisUsd: 500,
  unrealizedPnlUsd: null,
  unrealizedPnlPercent: null,
  entryPriceUsd: 100,
  closingPriceUsd: 110,
  positionValueUsd: 0,
  positionCostBasisUsd: 0,
  orderCount: 2,
  fillCount: 2,
  notionalUsd: 500,
};

describe("JournalMarketMetric", () => {
  it("shows the price and available returns without inventing a 30d return", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalMarketMetric, {
        summary: {
          priceUsd: 1600,
          change24hPercent: -2,
          change7dPercent: 10,
          change30dPercent: null,
        },
      }),
    );

    expect(markup).toContain("$1,600.00");
    expect(markup).toContain("-2.0%");
    expect(markup).toContain("+10.0%");
    expect(markup).toContain("<span>30d</span><b>N/A</b>");
    expect(markup).not.toContain("NaN");
  });

  it("shows a neutral price when even 24h history is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalMarketMetric, {
        summary: {
          priceUsd: 1600,
          change24hPercent: null,
          change7dPercent: null,
          change30dPercent: null,
        },
      }),
    );

    expect(markup).toContain("$1,600.00");
    expect(markup.match(/<b>N\/A<\/b>/g)).toHaveLength(3);
    expect(markup).not.toContain("metric-negative");
    expect(markup).not.toContain("metric-positive");
  });
});

describe("JournalFundingMetric", () => {
  it.each([
    [-1, "funding-rate-dark-green"],
    [0, "funding-rate-light-green"],
    [11.99, "funding-rate-light-green"],
    [12, "funding-rate-yellow"],
    [24.99, "funding-rate-yellow"],
    [25, "funding-rate-light-red"],
    [49.99, "funding-rate-light-red"],
    [50, "funding-rate-dark-red"],
  ])("classifies a %s%% long rate as %s", (value, expected) => {
    expect(getFundingRateTone(value, "long")).toBe(expected);
  });

  it.each([
    [-50.01, "funding-rate-dark-red"],
    [-50, "funding-rate-light-red"],
    [-20.01, "funding-rate-light-red"],
    [-20, "funding-rate-yellow"],
    [-0.01, "funding-rate-yellow"],
    [0, "funding-rate-light-green"],
    [11.99, "funding-rate-light-green"],
    [12, "funding-rate-dark-green"],
  ])("classifies a %s%% short rate as %s", (value, expected) => {
    expect(getFundingRateTone(value, "short")).toBe(expected);
  });

  it("colors each funding period independently", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalFundingMetric, {
        direction: "long",
        summary: {
          currentAnnualizedPercent: -1,
          average24hAnnualizedPercent: 5,
          average7dAnnualizedPercent: 20,
          average30dAnnualizedPercent: 55,
        },
      }),
    );

    expect(markup).toContain("journal-funding-metric funding-rate-dark-green");
    expect(markup).toContain("journal-funding-average funding-rate-light-green");
    expect(markup).toContain("journal-funding-average funding-rate-yellow");
    expect(markup).toContain("journal-funding-average funding-rate-dark-red");
  });

  it("uses neutral colors without a position direction", () => {
    expect(getFundingRateTone(20, null)).toBe("funding-rate-neutral");
  });
});

describe("JournalPnlMetric", () => {
  it("shows only total PnL when there is no position", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, {
        annualizedPercent: 25,
        summary,
      }),
    );

    expect(markup).toContain("Total PnL");
    expect(markup).toContain("+5.00% (+25.00% ann.)");
    expect(markup).not.toContain("Transactions PnL");
    expect(markup).not.toContain("Unrealized PnL");
  });

  it("shows the full PnL breakdown when a position exists", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, {
        summary: {
          ...summary,
          unrealizedPnlUsd: 10,
          unrealizedPnlPercent: 1,
          positionValueUsd: 1_000,
          positionCostBasisUsd: 990,
        },
      }),
    );

    expect(markup).toContain("Transactions PnL");
    expect(markup).toContain("+5.00%");
    expect(markup).toContain("Unrealized PnL");
    expect(markup).toContain("+1.00%");
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
