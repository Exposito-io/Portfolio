import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSparklinePoints, JournalTradeCard } from "@/components/journal-trade-card";
import type { HyperliquidCandle } from "@/lib/types";

it("shows a newly listed market's price and available returns on its card", () => {
  const markup = renderToStaticMarkup(createElement(JournalTradeCard, {
    trade: {
      id: "openai",
      kind: "idea",
      direction: null,
      title: "OpenAI",
      descriptionMarkdown: "",
      startDate: "2026-09-08T00:00:00.000Z",
      endDate: null,
      asset: { kind: "perp", label: "io:OAI perp", coin: "io:OAI", chartCoin: "io:OAI", dex: "io" },
      tradingViewCharts: [],
      entries: [],
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    },
    marketState: {
      candles: [],
      loading: false,
      error: "",
      summary: { priceUsd: 1600, change24hPercent: -2, change7dPercent: 10, change30dPercent: null },
    },
  }));

  expect(markup).toContain("$1,600.00");
  expect(markup).toContain("-2.00%");
  expect(markup).toContain("+10.00%");
  expect(markup).toContain("<span>30d</span><strong>N/A</strong>");
});

function candle(close: number): HyperliquidCandle {
  return {
    close,
    high: close,
    low: close,
    open: close,
    time: close,
    timeKey: "2026-09-04",
    volume: 1,
  };
}

describe("journal card sparkline", () => {
  it("plots the first and last candle across the full width", () => {
    expect(
      buildSparklinePoints([candle(10), candle(15), candle(20)], 100, 50, 5),
    ).toEqual(["0 45", "50 25", "100 5"]);
  });

  it("returns no points when there are no candles", () => {
    expect(buildSparklinePoints([], 100, 50, 5)).toEqual([]);
  });
});
