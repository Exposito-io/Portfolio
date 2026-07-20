import { describe, expect, it, vi } from "vitest";

import {
  fetchHyperliquidAccount,
  fetchHyperliquidCandles,
  fetchHyperliquidMarkets,
} from "@/lib/hyperliquid";
import type { PortfolioAccount } from "@/lib/types";

const account: PortfolioAccount = {
  id: "hl1",
  source: "hyperliquid",
  label: "Hyperliquid",
  address: "0x0000000000000000000000000000000000000000",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Hyperliquid normalization", () => {
  it("normalizes account value and open positions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            {
              coin: "USDC",
              token: 0,
              total: "4000",
              hold: "4000",
              entryNtl: "0.0",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          marginSummary: {
            accountValue: "3000.42",
            totalNtlPos: "2500",
            totalMarginUsed: "400",
          },
          withdrawable: "1200",
          assetPositions: [
            {
              position: {
                coin: "SOL",
                szi: "12",
                positionValue: "2500",
                unrealizedPnl: "100",
                marginUsed: "400",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          marginSummary: {
            accountValue: "1000",
            totalNtlPos: "5000",
            totalMarginUsed: "900",
          },
          withdrawable: "100",
          assetPositions: [
            {
              position: {
                coin: "xyz:XYZ100",
                szi: "2",
                positionValue: "5000",
                unrealizedPnl: "-25",
                marginUsed: "900",
              },
            },
          ],
        }),
      });

    const result = await fetchHyperliquidAccount(account, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "spotClearinghouseState",
          user: account.address,
        }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "clearinghouseState",
          user: account.address,
          dex: "xyz",
        }),
      }),
    );
    expect(result.summary.netWorthUsd).toBe(4000);
    expect(result.summary.totalInvestmentsUsd).toBe(7500);
    expect(result.summary.totalDebtUsd).toBe(3500);
    expect(result.positions).toHaveLength(3);
    expect(result.positions[0]).toMatchObject({
      symbol: "SOL",
      valueUsd: 2500,
      quantity: 12,
    });
    expect(result.positions[1]).toMatchObject({
      symbol: "xyz:XYZ100",
      name: "xyz:XYZ100 Trade XYZ perpetual position",
      valueUsd: 5000,
      quantity: 2,
    });
    expect(result.positions[2]).toMatchObject({
      symbol: "USDC",
      name: "Hyperliquid account debt",
      kind: "debt",
      debtUsd: 3500,
    });
  });

  it("normalizes main perp, spot, and Trade XYZ markets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          universe: [{ name: "BTC" }, { name: "ETH" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tokens: [
            { name: "USDC", index: 0 },
            { name: "HYPE", index: 150 },
          ],
          universe: [{ name: "@107", tokens: [150, 0], index: 107 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          universe: [{ name: "XYZ100" }],
        }),
      });

    const markets = await fetchHyperliquidMarkets(fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "meta",
          dex: "xyz",
        }),
      }),
    );
    expect(markets).toEqual(
      expect.arrayContaining([
        {
          kind: "perp",
          label: "BTC perp",
          coin: "BTC",
          chartCoin: "BTC",
        },
        {
          kind: "spot",
          label: "HYPE/USDC",
          coin: "@107",
          chartCoin: "@107",
        },
        {
          kind: "trade-xyz",
          label: "XYZ100 Trade XYZ perp",
          coin: "XYZ100",
          chartCoin: "xyz:XYZ100",
          dex: "xyz",
        },
      ]),
    );
  });

  it("requests candle snapshots with the selected coin, interval, and range", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          t: 1_799_900_000_000,
          o: "100",
          h: "110",
          l: "95",
          c: "108",
          v: "1234",
        },
      ],
    });

    const candles = await fetchHyperliquidCandles(
      {
        coin: "xyz:XYZ100",
        interval: "1d",
        days: 7,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: "xyz:XYZ100",
            interval: "1d",
            startTime: 1_799_395_200_000,
            endTime: 1_800_000_000_000,
          },
        }),
      }),
    );
    expect(candles).toEqual([
      {
        time: 1_799_900_000_000,
        timeKey: "2027-01-14",
        open: 100,
        high: 110,
        low: 95,
        close: 108,
        volume: 1234,
      },
    ]);
  });
});
