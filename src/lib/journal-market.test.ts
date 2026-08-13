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

  it("returns null without a full 30 days of history", () => {
    expect(calculateJournalMarketSummary([candle(1, 100, 101)])).toBeNull();
  });
});
