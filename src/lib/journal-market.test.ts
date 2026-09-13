import { describe, expect, it } from "vitest";

import { calculateJournalMarketSummary } from "@/lib/journal-market";
import type { HyperliquidCandle } from "@/lib/types";

function candle(time: number, open: number, close: number): HyperliquidCandle {
  return { time, timeKey: "2026-08-13", open, high: close, low: open, close, volume: 1 };
}

describe("journal market summary", () => {
  it("returns the latest price and trailing period changes", () => {
    expect(
      calculateJournalMarketSummary([
        candle(0, 100, 101),
        candle(23 * 24 * 60 * 60 * 1000, 125, 126),
        candle(29 * 24 * 60 * 60 * 1000, 140, 141),
        candle(30 * 24 * 60 * 60 * 1000, 145, 150),
      ]),
    ).toEqual({
      priceUsd: 150,
      change24hPercent: 7.14,
      change7dPercent: 20,
      change30dPercent: 50,
    });
  });

  it("keeps the price when no return period has enough history", () => {
    expect(calculateJournalMarketSummary([candle(1, 100, 101)])).toEqual({
      priceUsd: 101,
      change24hPercent: null,
      change7dPercent: null,
      change30dPercent: null,
    });
  });

  it("keeps 24h and 7d returns for a newly listed market without 30d history", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(calculateJournalMarketSummary([
      candle(10 * day, 145, 150),
      candle(0, 100, 101),
      candle(3 * day, 125, 126),
      candle(9 * day, 140, 141),
    ])).toEqual({
      priceUsd: 150,
      change24hPercent: 7.14,
      change7dPercent: 20,
      change30dPercent: null,
    });
  });

  it("returns null when no valid prices are available", () => {
    expect(calculateJournalMarketSummary([])).toBeNull();
    expect(calculateJournalMarketSummary([
      candle(1, 0, 100),
      candle(2, 100, Number.NaN),
    ])).toBeNull();
  });
});
