import { describe, expect, it, vi } from "vitest";

import {
  HyperliquidFillCache,
  type FillHistoryStore,
  type StoredHyperliquidFill,
} from "@/lib/hyperliquid-fill-cache";
import type { HyperliquidFill, PortfolioAccount } from "@/lib/types";

const account: PortfolioAccount = {
  id: "account-1",
  label: "Trading",
  address: "0xABC",
  source: "hyperliquid",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: "",
  updatedAt: "",
};

function fill(
  id: string,
  time: number,
  overrides: Partial<HyperliquidFill> = {},
): HyperliquidFill {
  return {
    id: `${account.id}:${id}`,
    accountId: account.id,
    accountLabel: account.label,
    coin: "BTC",
    side: "Sell",
    direction: "Close Long",
    price: 100,
    size: 2,
    notionalUsd: 200,
    fee: 0.02,
    feeToken: "USDC",
    closedPnl: 5,
    realizedPnlBasisUsd: 195,
    time,
    timeKey: new Date(time).toISOString(),
    hash: null,
    orderId: 42,
    crossed: false,
    ...overrides,
  };
}

function memoryStore() {
  const documents = new Map<string, StoredHyperliquidFill>();
  const states = new Map<
    string,
    NonNullable<Awaited<ReturnType<FillHistoryStore["getSync"]>>>
  >();
  const store: FillHistoryStore = {
    getSync: vi.fn(async (wallet) => states.get(wallet) ?? null),
    saveFills: vi.fn(async (fills) => {
      for (const fill of fills) documents.set(fill._id, fill);
    }),
    saveSync: vi.fn(async (state) => {
      states.set(state._id, state);
    }),
    readFills: vi.fn(async (wallet, start, end, coins) =>
      [...documents.values()].filter(
        (fill) =>
          fill.wallet === wallet &&
          fill.time >= start &&
          fill.time <= end &&
          (!coins || coins.includes(fill.coin)),
      ),
    ),
  };
  return { store, documents, states };
}

describe("persistent Hyperliquid fill history", () => {
  it("shares one bootstrap across five journal ranges and Stats, fetching every market through now", async () => {
    const { store, documents, states } = memoryStore();
    const fetchFills = vi
      .fn()
      .mockResolvedValue([
        fill("1", 900_000),
        fill("2", 950_000, { coin: "io:OAI", orderId: 43 }),
      ]);
    const cache = new HyperliquidFillCache(store, fetchFills, () => 1_000_000);
    const journals = Array.from({ length: 5 }, (_, index) =>
      cache.getOrders({
        account,
        startTime: index * 1000,
        endTime: 970_000,
        coinAliases: ["BTC"],
      }),
    );
    const results = await Promise.all([
      ...journals,
      cache.getOrders({ account, startTime: 0, endTime: 1_000_000 }),
    ]);
    expect(fetchFills).toHaveBeenCalledExactlyOnceWith({
      account: { ...account, address: "0xabc" },
      startTime: 0,
      endTime: 1_000_000,
      aggregateByTime: false,
    });
    expect(results.map((orders) => orders.length)).toEqual([1, 1, 1, 1, 1, 2]);
    expect(documents.get("0xabc:1")?.time).toEqual(new Date(900_000));
    expect(documents.get("0xabc:1")).not.toHaveProperty("timeKey");
    expect(documents.get("0xabc:1")).not.toHaveProperty("accountId");
    expect(states.get("0xabc")).toEqual({
      _id: "0xabc",
      syncedThrough: new Date(1_000_000),
      refreshedAt: new Date(1_000_000),
    });
  });

  it("reuses persisted history after a restart and applies current account labels", async () => {
    const { store } = memoryStore();
    const fetchFills = vi.fn().mockResolvedValue([fill("1", 900_000)]);
    await new HyperliquidFillCache(
      store,
      fetchFills,
      () => 1_000_000,
    ).getOrders({ account, startTime: 0, endTime: 1_000_000 });
    fetchFills.mockClear();
    const restarted = new HyperliquidFillCache(
      store,
      fetchFills,
      () => 1_010_000,
    );
    const orders = await restarted.getOrders({
      account: {
        ...account,
        id: "renamed-id",
        label: "Renamed",
        address: "0xabc",
      },
      startTime: 0,
      endTime: 1_010_000,
    });
    expect(fetchFills).not.toHaveBeenCalled();
    expect(orders[0]).toMatchObject({
      accountId: "renamed-id",
      accountLabel: "Renamed",
      closedPnl: 5,
    });
  });

  it("refreshes only the recent interval, deduplicates overlap, and includes late-arriving fills", async () => {
    const { store, documents } = memoryStore();
    let now = 1_000_000;
    const original = fill("1", 990_000);
    const fetchFills = vi
      .fn()
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([
        original,
        fill("late", 995_000),
        fill("new", 1_050_000),
      ]);
    const cache = new HyperliquidFillCache(store, fetchFills, () => now);
    await cache.getOrders({ account, startTime: 0, endTime: now });
    now += 59_999;
    await cache.getOrders({ account, startTime: 0, endTime: now });
    expect(fetchFills).toHaveBeenCalledTimes(1);
    now += 1;
    const orders = await cache.getOrders({
      account,
      startTime: 0,
      endTime: now,
    });
    expect(fetchFills.mock.calls[1][0]).toMatchObject({
      startTime: 700_000,
      endTime: 1_060_000,
      aggregateByTime: false,
    });
    expect(documents.size).toBe(3);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      fillCount: 3,
      totalSize: 6,
      closedPnl: 15,
      fee: 0.06,
    });
  });

  it("serves covered closed ranges without refreshing, filtering before grouping orders", async () => {
    const { store } = memoryStore();
    const fetchFills = vi
      .fn()
      .mockResolvedValue([fill("1", 800_000), fill("2", 950_000)]);
    await new HyperliquidFillCache(
      store,
      fetchFills,
      () => 1_000_000,
    ).getOrders({ account, startTime: 0, endTime: 1_000_000 });
    fetchFills.mockClear();
    const orders = await new HyperliquidFillCache(
      store,
      fetchFills,
      () => 2_000_000,
    ).getOrders({ account, startTime: 800_000, endTime: 900_000 });
    expect(fetchFills).not.toHaveBeenCalled();
    expect(orders[0]).toMatchObject({ fillCount: 1, closedPnl: 5 });
  });

  it("still refreshes a live request that joins a covered historical request", async () => {
    const { store } = memoryStore();
    const fetchFills = vi.fn().mockResolvedValue([fill("1", 900_000)]);
    let now = 1_000_000;
    const cache = new HyperliquidFillCache(store, fetchFills, () => now);
    await cache.getOrders({ account, startTime: 0, endTime: now });
    now = 1_100_000;
    await Promise.all([
      cache.getOrders({ account, startTime: 0, endTime: 950_000 }),
      cache.getOrders({ account, startTime: 0, endTime: now }),
    ]);
    expect(fetchFills).toHaveBeenCalledTimes(2);
  });

  it("does not mark failed fetches or writes as synchronized and allows a retry", async () => {
    const { store, states } = memoryStore();
    const fetchFills = vi
      .fn()
      .mockRejectedValueOnce(new Error("Rate limited"))
      .mockResolvedValue([fill("1", 900_000)]);
    const cache = new HyperliquidFillCache(store, fetchFills, () => 1_000_000);
    const query = { account, startTime: 0, endTime: 1_000_000 };
    await expect(cache.getOrders(query)).rejects.toThrow("Rate limited");
    expect(states.size).toBe(0);
    vi.mocked(store.saveFills).mockRejectedValueOnce(new Error("Write failed"));
    await expect(cache.getOrders(query)).rejects.toThrow("Write failed");
    expect(states.size).toBe(0);
    expect(await cache.getOrders(query)).toHaveLength(1);
    expect(states.size).toBe(1);
  });

  it("caches empty wallets and keeps different wallet histories separate", async () => {
    const { store } = memoryStore();
    const fetchFills = vi.fn().mockResolvedValue([]);
    const cache = new HyperliquidFillCache(store, fetchFills, () => 1_000_000);
    const query = { account, startTime: 0, endTime: 1_000_000 };
    expect(await cache.getOrders(query)).toEqual([]);
    expect(await cache.getOrders(query)).toEqual([]);
    await cache.getOrders({
      ...query,
      account: { ...account, address: "0xdef" },
    });
    expect(fetchFills).toHaveBeenCalledTimes(2);
  });
});
