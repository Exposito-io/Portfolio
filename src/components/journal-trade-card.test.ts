import { describe, expect, it } from "vitest";

import { buildSparklinePoints } from "@/components/journal-trade-card";
import type { HyperliquidCandle } from "@/lib/types";

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
