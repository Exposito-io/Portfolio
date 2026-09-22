import { describe, expect, it } from "vitest";

import {
  getJournalAssetKey,
  getOpenPositionMarketKeys,
} from "@/lib/journal-market-options";
import type { JournalTradeAsset, PortfolioPosition } from "@/lib/types";

const markets: JournalTradeAsset[] = [
  {
    kind: "perp",
    label: "BTC perp",
    coin: "BTC",
    chartCoin: "BTC",
  },
  {
    kind: "trade-xyz",
    label: "XYZ100 Trade XYZ perp",
    coin: "XYZ100",
    chartCoin: "xyz:XYZ100",
    dex: "xyz",
  },
  {
    kind: "perp",
    label: "io:OAI perp",
    coin: "io:OAI",
    chartCoin: "io:OAI",
    dex: "io",
  },
];

function position(
  overrides: Partial<PortfolioPosition>,
): PortfolioPosition {
  return {
    id: "position",
    accountId: "account",
    accountLabel: "Hyperliquid",
    source: "hyperliquid",
    symbol: "BTC",
    name: "BTC perpetual position",
    kind: "asset",
    quantity: 1,
    valueUsd: 100,
    debtUsd: 0,
    details: { dex: "default" },
    ...overrides,
  };
}

describe("journal market options", () => {
  it("matches open positions to their Hyperliquid venue and removes duplicates", () => {
    const keys = getOpenPositionMarketKeys(markets, [
      position({ id: "btc-one" }),
      position({ id: "btc-two" }),
      position({
        id: "xyz",
        symbol: "xyz:XYZ100",
        details: { dex: "xyz" },
      }),
      position({
        id: "wrong-venue",
        symbol: "io:OAI",
        details: { dex: "default" },
      }),
      position({ id: "debt", kind: "debt", symbol: "USDC" }),
      position({ id: "aave", source: "aave" }),
    ]);

    expect(keys).toEqual([
      getJournalAssetKey(markets[0]),
      getJournalAssetKey(markets[1]),
    ]);
  });
});
