import { describe, expect, it, vi } from "vitest";

import {
  fetchHyperliquidAccount,
  fetchHyperliquidCandles,
  fetchHyperliquidFilledOrdersByTime,
  fetchHyperliquidMarkets,
  fetchHyperliquidOpenPositionPnl,
  fetchHyperliquidUserFillsByTime,
  getHyperliquidCoinAliases,
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

  it("normalizes user fills by time for selected asset aliases", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          coin: "xyz:XYZ100",
          px: "123.45",
          sz: "2",
          side: "B",
          time: 1_800_000_000_000,
          dir: "Open Long",
          closedPnl: "0",
          hash: "0xabc",
          oid: 42,
          crossed: true,
          fee: "0.12",
          feeToken: "USDC",
          tid: 99,
        },
        {
          coin: "BTC",
          px: "64000",
          sz: "0.1",
          side: "A",
          time: 1_800_000_001_000,
          tid: 100,
        },
      ],
    });

    const fills = await fetchHyperliquidUserFillsByTime(
      {
        account,
        startTime: 1_799_999_000_000,
        endTime: 1_800_001_000_000,
        coinAliases: ["xyz:XYZ100", "XYZ100"],
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "userFillsByTime",
          user: account.address,
          startTime: 1_799_999_000_000,
          endTime: 1_800_001_000_000,
          aggregateByTime: true,
        }),
      }),
    );
    expect(fills).toEqual([
      expect.objectContaining({
        id: "hl1:99",
        coin: "xyz:XYZ100",
        side: "Buy",
        price: 123.45,
        size: 2,
        notionalUsd: 246.9,
        fee: 0.12,
        feeToken: "USDC",
        closedPnl: 0,
      }),
    ]);
  });

  it("builds Trade XYZ coin aliases with and without the dex prefix", () => {
    expect(
      getHyperliquidCoinAliases({
        kind: "trade-xyz",
        label: "XYZ100 Trade XYZ perp",
        coin: "XYZ100",
        chartCoin: "xyz:XYZ100",
        dex: "xyz",
      }),
    ).toEqual(["XYZ100", "xyz:XYZ100"]);
  });

  it("loads Trade XYZ unrealized PnL from the xyz clearinghouse state", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assetPositions: [
          {
            position: {
              coin: "xyz:DRAM",
              unrealizedPnl: "17443.2072",
            },
          },
          {
            position: {
              coin: "xyz:OTHER",
              unrealizedPnl: "-100",
            },
          },
        ],
      }),
    });

    const pnl = await fetchHyperliquidOpenPositionPnl(
      {
        account,
        asset: {
          kind: "trade-xyz",
          label: "xyz:DRAM Trade XYZ perp",
          coin: "xyz:DRAM",
          chartCoin: "xyz:DRAM",
          dex: "xyz",
        },
      },
      fetcher,
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
    expect(pnl).toBe(17443.21);
  });

  it("aggregates fills into filled orders by order id", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          coin: "BTC",
          px: "100",
          sz: "1",
          side: "B",
          time: 1_800_000_000_000,
          dir: "Open Long",
          oid: 42,
          fee: "0.1",
          feeToken: "USDC",
          tid: 1,
        },
        {
          coin: "BTC",
          px: "110",
          sz: "2",
          side: "B",
          time: 1_800_000_001_000,
          dir: "Open Long",
          oid: 42,
          fee: "0.2",
          feeToken: "USDC",
          tid: 2,
        },
      ],
    });

    const orders = await fetchHyperliquidFilledOrdersByTime(
      {
        account,
        startTime: 1_799_999_000_000,
        endTime: 1_800_001_000_000,
        coinAliases: ["BTC"],
      },
      fetcher,
    );

    expect(orders).toEqual([
      expect.objectContaining({
        id: "hl1:42:BTC:Buy",
        side: "Buy",
        direction: "Open Long",
        averagePrice: 106.67,
        totalSize: 3,
        notionalUsd: 320,
        fee: 0.3,
        feeToken: "USDC",
        orderId: 42,
        fillCount: 2,
      }),
    ]);
  });
});
