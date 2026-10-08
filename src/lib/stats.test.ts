import { describe, expect, it, vi } from "vitest";
import { buildStatsPnl } from "@/lib/stats";
import { loadStats } from "@/lib/stats-service";
import type { HyperliquidFilledOrder, PortfolioAccount } from "@/lib/types";

const order: HyperliquidFilledOrder = {
  id: "a",
  accountId: "wallet",
  accountLabel: "Wallet",
  coin: "BTC",
  side: "Sell",
  direction: "Close Long",
  averagePrice: 100,
  totalSize: 1,
  notionalUsd: 100,
  fee: 5,
  feeToken: "USDC",
  closedPnl: 10,
  realizedPnlBasisUsd: 90,
  firstTime: 1,
  lastTime: 1,
  orderId: 1,
  fillCount: 1,
};
const account: PortfolioAccount = {
  id: "wallet",
  label: "Wallet",
  address: "0xABC",
  source: "hyperliquid",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: "",
  updatedAt: "",
};

describe("stats realized P/L", () => {
  it("sums orders chronologically across wallets, without deducting fees, and matches every table total", () => {
    const result = buildStatsPnl([
      { ...order, id: "d", lastTime: 4, closedPnl: null },
      {
        ...order,
        id: "c",
        accountId: "second",
        lastTime: 3,
        closedPnl: -20.25,
      },
      { ...order, id: "b", lastTime: 2, closedPnl: 0 },
      order,
    ]);
    expect(result.points).toEqual([
      { time: 1, pnlUsd: 10 },
      { time: 2, pnlUsd: 10 },
      { time: 3, pnlUsd: -10.25 },
      { time: 4, pnlUsd: -10.25 },
    ]);
    expect([...result.cumulativePnlByOrderId.values()]).toEqual(
      result.points.map((point) => point.pnlUsd),
    );
    expect(result.totalPnlUsd).toBe(-10.25);
  });

  it("combines identical timestamps deterministically and supports a single point", () => {
    const result = buildStatsPnl([{ ...order, id: "b", closedPnl: -3 }, order]);
    expect(result.points).toEqual([{ time: 1, pnlUsd: 7 }]);
    expect(result.cumulativePnlByOrderId.get("a")).toBe(10);
    expect(result.cumulativePnlByOrderId.get("b")).toBe(7);
  });

  it("does not report a zero profit for missing P/L or an empty history", () => {
    for (const orders of [[], [{ ...order, closedPnl: null }]]) {
      expect(buildStatsPnl(orders)).toMatchObject({
        points: [],
        totalPnlUsd: null,
      });
    }
    expect(buildStatsPnl([{ ...order, closedPnl: 0 }]).totalPnlUsd).toBe(0);
  });
});

describe("stats history", () => {
  it("loads all markets from enabled, distinct Hyperliquid wallets only", async () => {
    const source = {
      syncAccount: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({
        orders: [order],
        orderCount: 1,
        points: [{ time: 1, pnlUsd: 10 }],
        totalPnlUsd: 10,
        cumulativePnlByOrderId: { a: 10 },
        historyStartTime: 1,
      }),
    };
    const result = await loadStats(
      [
        account,
        { ...account, id: "duplicate", address: "0xabc" },
        { ...account, id: "disabled", address: "0xDEF", enabled: false },
        { ...account, id: "aave", address: "0x123", source: "aave" },
      ],
      100,
      source,
    );
    expect(source.syncAccount).toHaveBeenCalledExactlyOnceWith(account, 100);
    expect(source.getStats).toHaveBeenCalledWith({
      accounts: [account],
      page: 0,
      pageSize: 50,
      includeOrders: true,
    });
    expect(result).toEqual({
      orders: [order],
      orderCount: 1,
      page: 0,
      pageSize: 50,
      points: [{ time: 1, pnlUsd: 10 }],
      totalPnlUsd: 10,
      cumulativePnlByOrderId: { a: 10 },
      historyStartTime: 1,
      accountsCount: 1,
      endTime: 100,
      sourceErrors: [],
    });
  });

  it("retains successful wallets and reports failures without inventing results", async () => {
    const source = {
      syncAccount: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Rate limited")),
      getStats: vi.fn().mockResolvedValue({
        orders: [order],
        orderCount: 1,
        points: [{ time: 1, pnlUsd: 10 }],
        totalPnlUsd: 10,
        cumulativePnlByOrderId: { a: 10 },
        historyStartTime: 1,
      }),
    };
    const result = await loadStats(
      [
        account,
        { ...account, id: "second", address: "0xDEF", label: "Second" },
      ],
      100,
      source,
    );
    expect(result.orders).toEqual([order]);
    expect(result.accountsCount).toBe(2);
    expect(result.sourceErrors).toEqual([
      {
        source: "hyperliquid",
        accountId: "second",
        accountLabel: "Second",
        message: "Rate limited",
      },
    ]);
  });

  it("does not contact Hyperliquid with no enabled wallets", async () => {
    const source = {
      syncAccount: vi.fn(),
      getStats: vi.fn().mockResolvedValue({
        orders: [],
        orderCount: 0,
        points: [],
        totalPnlUsd: null,
        cumulativePnlByOrderId: {},
        historyStartTime: null,
      }),
    };
    expect(await loadStats([], 100, source)).toMatchObject({
      orders: [],
      orderCount: 0,
      accountsCount: 0,
      sourceErrors: [],
    });
    expect(source.syncAccount).not.toHaveBeenCalled();
  });
});
