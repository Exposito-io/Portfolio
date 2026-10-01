import { describe, expect, it, vi } from "vitest";

import {
  HyperliquidCandleCache,
  type HyperliquidCandleStore,
} from "@/lib/hyperliquid-candle-cache";
import type { HyperliquidCandleInterval } from "@/lib/hyperliquid";
import type { HyperliquidCandle } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function createStore() {
  let coverage: Awaited<ReturnType<HyperliquidCandleStore["getCoverage"]>> = null;
  const candles = new Map<
    string,
    Awaited<ReturnType<HyperliquidCandleStore["readCandles"]>>[number]
  >();
  let leaseOwner: string | null = null;

  const store: HyperliquidCandleStore = {
    ensureIndexes: vi.fn(async () => undefined),
    getCoverage: vi.fn(async () => coverage),
    readCandles: vi.fn(async (coin, interval, start, end) =>
      [...candles.values()].filter(
        (candle) =>
          candle.coin === coin &&
          candle.interval === interval &&
          candle.openTime >= start &&
          candle.openTime <= end,
      ),
    ),
    saveCandles: vi.fn(async (documents) => {
      for (const document of documents) candles.set(document._id, document);
    }),
    saveCoverage: vi.fn(async (document) => {
      coverage = document;
    }),
    acquireLease: vi.fn(async (_key, owner) => {
      if (leaseOwner && leaseOwner !== owner) return false;
      leaseOwner = owner;
      return true;
    }),
    releaseLease: vi.fn(async (_key, owner) => {
      if (leaseOwner === owner) leaseOwner = null;
    }),
  };

  return { candles, getCoverage: () => coverage, store };
}

function candle(time: number, close = 100): HyperliquidCandle {
  return {
    time,
    timeKey: new Date(time).toISOString().slice(0, 10),
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 42,
  };
}

describe("persistent Hyperliquid candle cache", () => {
  it("backfills once, stores native dates, and later fetches only the live overlap", async () => {
    let now = 1_800_000_000_000;
    const { candles, getCoverage, store } = createStore();
    const fetcher = vi.fn(
      async ({ startTime, endTime }: { coin: string; interval: HyperliquidCandleInterval; startTime: number; endTime: number }) => [
        candle(startTime, 90),
        candle(endTime - 15 * 60_000, 100),
      ],
    );
    const cache = new HyperliquidCandleCache(store, fetcher, () => now);

    const first = await cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    expect(first).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith({
      coin: "BTC",
      interval: "15m",
      startTime: now - 31 * DAY_MS,
      endTime: now,
    });
    expect([...candles.values()][0].openTime).toBeInstanceOf(Date);
    expect([...candles.values()][0].updatedAt).toBeInstanceOf(Date);
    expect([...candles.values()][0].expiresAt).toBeInstanceOf(Date);
    expect(getCoverage()?.coveredFrom).toBeInstanceOf(Date);

    now += 5_000;
    await cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const previousEnd = now - 5_000;
    now += 56_000;
    await cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const incremental = fetcher.mock.calls[1][0];
    expect(incremental.startTime).toBe(previousEnd - 30 * 60_000);
    expect(incremental.endTime).toBe(now);
  });

  it("serves a complete stale range when an incremental refresh fails", async () => {
    let now = 1_800_000_000_000;
    const { store } = createStore();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([candle(now - 15 * 60_000)])
      .mockRejectedValueOnce(new Error("Hyperliquid unavailable"));
    const cache = new HyperliquidCandleCache(store, fetcher, () => now);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fresh = await cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    now += 61_000;
    const stale = await cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });

    expect(stale).toEqual(fresh);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      "Serving stale Hyperliquid candles for BTC after refresh failed.",
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("records empty ranges so inactive markets are not repeatedly backfilled", async () => {
    const now = 1_800_000_000_000;
    const { store } = createStore();
    const fetcher = vi.fn(async () => []);
    const cache = new HyperliquidCandleCache(store, fetcher, () => now);

    await expect(
      cache.getCandles({ coin: "NEW", interval: "15m", days: 31 }),
    ).resolves.toEqual([]);
    await expect(
      cache.getCandles({ coin: "NEW", interval: "15m", days: 31 }),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent refreshes for the same market", async () => {
    const now = 1_800_000_000_000;
    const { store } = createStore();
    let resolveFetch!: (candles: HyperliquidCandle[]) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<HyperliquidCandle[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cache = new HyperliquidCandleCache(store, fetcher, () => now);

    const first = cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    const second = cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolveFetch([candle(now - 15 * 60_000)]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [candle(now - 15 * 60_000)],
      [candle(now - 15 * 60_000)],
    ]);
    expect(store.acquireLease).toHaveBeenCalledTimes(1);
  });

  it("fills a wider concurrent range after joining a narrower refresh", async () => {
    const now = 1_800_000_000_000;
    const { store } = createStore();
    let resolveFirst!: (candles: HyperliquidCandle[]) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<HyperliquidCandle[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue([]);
    const cache = new HyperliquidCandleCache(store, fetcher, () => now);

    const narrow = cache.getCandles({ coin: "BTC", interval: "15m", days: 7 });
    const wide = cache.getCandles({ coin: "BTC", interval: "15m", days: 31 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolveFirst([candle(now - DAY_MS)]);

    await Promise.all([narrow, wide]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toMatchObject({
      startTime: now - 31 * DAY_MS,
      endTime: now - 7 * DAY_MS - 1,
    });
  });
});
