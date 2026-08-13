import type { HyperliquidCandle } from "@/lib/types";

export type JournalMarketSummary = {
  priceUsd: number;
  change24hPercent: number;
  change7dPercent: number;
  change30dPercent: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateJournalMarketSummary(
  candles: HyperliquidCandle[],
): JournalMarketSummary | null {
  const validCandles = candles.filter(
    (candle) =>
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.close) &&
      candle.open > 0 &&
      candle.close > 0,
  );
  if (!validCandles.length) return null;

  const latest = validCandles.reduce((current, candle) =>
    candle.time > current.time ? candle : current,
  );
  const change24hPercent = calculateChange(validCandles, latest, 1);
  const change7dPercent = calculateChange(validCandles, latest, 7);
  const change30dPercent = calculateChange(validCandles, latest, 30);
  if (
    change24hPercent === null ||
    change7dPercent === null ||
    change30dPercent === null
  ) {
    return null;
  }

  return {
    priceUsd: latest.close,
    change24hPercent,
    change7dPercent,
    change30dPercent,
  };
}

function calculateChange(
  candles: HyperliquidCandle[],
  latest: HyperliquidCandle,
  days: number,
) {
  const cutoff = latest.time - days * DAY_MS;
  const reference = candles.reduce<HyperliquidCandle | null>(
    (current, candle) => {
      if (candle.time > cutoff) return current;
      return !current || candle.time > current.time ? candle : current;
    },
    null,
  );
  if (!reference) return null;

  return Math.round((latest.close / reference.open - 1) * 10000) / 100;
}
