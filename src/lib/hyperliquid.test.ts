import { describe, expect, it, vi } from "vitest";

import {
  fetchHyperliquidAccount,
  fetchHyperliquidCandles,
  fetchHyperliquidCurrentFundingRate,
  fetchHyperliquidFilledOrdersByTime,
  fetchHyperliquidFundingHistory,
  fetchHyperliquidMarkets,
  fetchHyperliquidOpenPositionPnl,
  fetchHyperliquidOpenPositionSummary,
  fetchHyperliquidUserFillsByTime,
  fetchHyperliquidUserFunding,
  aggregateFillsToOrders,
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
  it("preserves P/L rounding when an order has many small individual fills", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => Array.from({ length: 101 }, (_, tid) => ({
      coin: "BTC", px: "1", sz: "1", time: tid + 1, tid, oid: 42, closedPnl: "-0.005",
    })) });
    const fills = await fetchHyperliquidUserFillsByTime({ account, startTime: 0, endTime: 200, aggregateByTime: false }, fetcher);
    expect(aggregateFillsToOrders(fills)[0].closedPnl).toBe(-0.5);
    expect(aggregateFillsToOrders([...fills].reverse())[0].closedPnl).toBe(-0.5);
  });

  it("reads raw history beyond ten pages without truncating or double counting", async () => {
    vi.useFakeTimers();
    try {
      let page = 0;
      const fetcher = vi.fn(async () => {
        const offset = page++ * 2000;
        return { ok: true, json: async () => Array.from({ length: page <= 11 ? 2000 : 1 }, (_, index) => ({
          coin: "BTC", px: "1", sz: "1", time: offset + index + 1, tid: offset + index,
        })) };
      });
      const result = fetchHyperliquidUserFillsByTime({ account, startTime: 0, endTime: 30_000, aggregateByTime: false }, fetcher as unknown as typeof fetch);
      const assertion = expect(result).resolves.toHaveLength(22_001);
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(12);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects raw fills without stable IDs instead of persisting ambiguous duplicates", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ coin: "BTC", time: 1, oid: 42 }] });
    await expect(fetchHyperliquidUserFillsByTime({ account, startTime: 0, endTime: 100, aggregateByTime: false }, fetcher)).rejects.toThrow("stable trade ID");
  });

  it("fails visibly if a full page cannot advance the timestamp cursor", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => Array.from({ length: 2000 }, (_, tid) => ({ coin: "BTC", time: 100, tid })) });
    await expect(fetchHyperliquidUserFillsByTime({ account, startTime: 0, endTime: 200 }, fetcher)).rejects.toThrow("could not be fully paginated");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("loads all markets over multiple fill pages when no aliases are supplied", async () => {
    const firstPage = Array.from({ length: 2000 }, (_, index) => ({
      coin: index % 2 ? "@107" : "BTC", time: index + 1,
      px: "0.0037295", sz: "2", side: "B", oid: index, tid: index,
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => [
        firstPage[1999],
        { coin: "io:OAI", time: 2001, px: "123", sz: "1", oid: 2000, tid: 2000 },
        { coin: "xyz:DRAM", time: 2002, px: "50", sz: "1", oid: 2001, tid: 2001 },
      ] });
    const orders = await fetchHyperliquidFilledOrdersByTime({ account, startTime: 0, endTime: 3000 }, fetcher);
    expect(orders).toHaveLength(2002);
    expect(new Set(orders.map((order) => order.coin))).toEqual(new Set(["BTC", "@107", "io:OAI", "xyz:DRAM"]));
    expect(orders.at(-1)?.averagePrice).toBe(0.0037295);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).startTime).toBe(2000);
  });

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

  it("normalizes main perp, spot, Trade XYZ, and io markets", async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          universe: [{ name: "io:OAI" }, { name: "ANTH" }, {}],
        }),
      });

    const markets = await fetchHyperliquidMarkets(fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({ type: "meta", dex: "io" }),
      }),
    );
    expect(markets).toHaveLength(6);
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
        {
          kind: "perp",
          label: "io:OAI perp",
          coin: "io:OAI",
          chartCoin: "io:OAI",
          dex: "io",
        },
        {
          kind: "perp",
          label: "io:ANTH perp",
          coin: "io:ANTH",
          chartCoin: "io:ANTH",
          dex: "io",
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

  it("loads and normalizes paginated funding history", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { coin: "ETH", fundingRate: "0.00001", time: 1000 },
          { coin: "ETH", fundingRate: "-0.00002", time: 2000 },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    await expect(
      fetchHyperliquidFundingHistory(
        { coin: "ETH", startTime: 0, endTime: 3000 },
        fetcher,
      ),
    ).resolves.toEqual([
      { coin: "ETH", fundingRate: 0.00001, time: 1000 },
      { coin: "ETH", fundingRate: -0.00002, time: 2000 },
    ]);

    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "fundingHistory",
          coin: "ETH",
          startTime: 2001,
          endTime: 3000,
        }),
      }),
    );
  });

  it("loads the live funding rate from the matching perp context", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { universe: [{ name: "BTC" }, { name: "xyz:XYZ100" }] },
        [{ funding: "0.00001" }, { funding: "-0.00002" }],
      ],
    });

    await expect(
      fetchHyperliquidCurrentFundingRate(
        { coin: "xyz:XYZ100", dex: "xyz" },
        fetcher,
      ),
    ).resolves.toBe(-0.00002);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" }),
      }),
    );
  });

  it("sums the account's funding payments for the coin within the window", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          time: 1000,
          delta: { type: "funding", coin: "ETH", fundingUsdc: "-1.25" },
        },
        {
          time: 2000,
          delta: { type: "funding", coin: "ETH", fundingUsdc: "0.5" },
        },
        {
          time: 2500,
          delta: { type: "funding", coin: "BTC", fundingUsdc: "10" },
        },
        {
          time: 5000,
          delta: { type: "funding", coin: "ETH", fundingUsdc: "99" },
        },
        {
          time: 1500,
          delta: { type: "spotTransfer", coin: "ETH", fundingUsdc: "50" },
        },
        {
          time: 1600,
          delta: { type: "funding", coin: "ETH", fundingUsdc: "broken" },
        },
      ],
    });

    await expect(
      fetchHyperliquidUserFunding(
        { account, coinAliases: ["ETH"], startTime: 500, endTime: 3000 },
        fetcher,
      ),
    ).resolves.toBe(-0.75);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "userFunding",
          user: account.address,
        }),
      }),
    );
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
              entryPx: "1.234567",
              szi: "419044.27",
              positionValue: "517419.8696",
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

    const summary = await fetchHyperliquidOpenPositionSummary(
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
    expect(summary).toEqual({
      entryPriceUsd: 1.234567,
      positionSize: 419044.27,
      positionValueUsd: 517419.87,
      positionCostBasisUsd: 517338.23,
      unrealizedPnlUsd: 17443.21,
    });
  });

  it("loads io position PnL from its dex without matching another venue's ticker", async () => {
    const asset = {
      kind: "perp" as const,
      label: "io:OAI perp",
      coin: "io:OAI",
      chartCoin: "io:OAI",
      dex: "io",
    };
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assetPositions: [
          {
            position: {
              coin: "io:OAI",
              entryPx: "100",
              szi: "2",
              positionValue: "220",
              unrealizedPnl: "20",
            },
          },
          { position: { coin: "OAI", unrealizedPnl: "999" } },
        ],
      }),
    });

    expect(getHyperliquidCoinAliases(asset)).toEqual(["io:OAI"]);
    await expect(
      fetchHyperliquidOpenPositionSummary({ account, asset }, fetcher),
    ).resolves.toEqual({
      entryPriceUsd: 100,
      positionSize: 2,
      positionValueUsd: 220,
      positionCostBasisUsd: 200,
      unrealizedPnlUsd: 20,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: JSON.stringify({
          type: "clearinghouseState",
          user: account.address,
          dex: "io",
        }),
      }),
    );
  });

  it("size-weights entry prices across matching position aliases", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assetPositions: [
          {
            position: {
              coin: "xyz:DRAM",
              entryPx: "1",
              szi: "100",
              positionValue: "100",
              unrealizedPnl: "10",
            },
          },
          {
            position: {
              coin: "DRAM",
              entryPx: "2",
              szi: "300",
              positionValue: "600",
              unrealizedPnl: "20",
            },
          },
        ],
      }),
    });

    await expect(
      fetchHyperliquidOpenPositionSummary(
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
      ),
    ).resolves.toEqual({
      entryPriceUsd: 1.75,
      positionSize: 400,
      positionValueUsd: 700,
      positionCostBasisUsd: 700,
      unrealizedPnlUsd: 30,
    });
  });

  it("keeps the open position PnL helper as a shortcut", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assetPositions: [
          {
            position: {
              coin: "BTC",
              entryPx: "50000",
              szi: "0.02",
              positionValue: "1000",
              unrealizedPnl: "-25",
            },
          },
        ],
      }),
    });

    const pnl = await fetchHyperliquidOpenPositionPnl(
      {
        account,
        asset: {
          kind: "perp",
          label: "BTC perp",
          coin: "BTC",
          chartCoin: "BTC",
        },
      },
      fetcher,
    );

    expect(pnl).toBe(-25);
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
        averagePrice: 320 / 3,
        totalSize: 3,
        notionalUsd: 320,
        fee: 0.3,
        feeToken: "USDC",
        realizedPnlBasisUsd: null,
        orderId: 42,
        fillCount: 2,
      }),
    ]);
  });

  it("calculates realized PnL cost basis for long and short closes", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          coin: "BTC",
          px: "110",
          sz: "1",
          side: "A",
          time: 1_800_000_000_000,
          dir: "Close Long",
          closedPnl: "10",
          oid: 42,
          tid: 1,
        },
        {
          coin: "BTC",
          px: "90",
          sz: "1",
          side: "B",
          time: 1_800_000_001_000,
          dir: "Close Short",
          closedPnl: "10",
          oid: 43,
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
        direction: "Close Short",
        realizedPnlBasisUsd: 100,
      }),
      expect.objectContaining({
        direction: "Close Long",
        realizedPnlBasisUsd: 100,
      }),
    ]);
  });
});
