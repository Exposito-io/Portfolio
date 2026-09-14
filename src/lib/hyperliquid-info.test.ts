import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getHyperliquidSnapshotTime,
  HyperliquidInfoClient,
} from "@/lib/hyperliquid-info";
import {
  fetchHyperliquidCandles,
  fetchHyperliquidMarkets,
} from "@/lib/hyperliquid";

const response = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.useRealTimers());

describe("Hyperliquid request caching", () => {
  it("lets live positions use remaining budget while history requests wait", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => response([]));
    const client = new HyperliquidInfoClient(fetcher);
    await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        client.request(
          { type: "userFillsByTime", user: `wallet-${index}` },
          "fills",
        ),
      ),
    );
    const waiting = client.request(
      { type: "userFillsByTime", user: "next" },
      "fills",
    );
    await client.request(
      { type: "clearinghouseState", user: "live" },
      "positions",
    );
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(JSON.parse(fetcher.mock.calls[7][1]!.body as string).type).toBe(
      "clearinghouseState",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await waiting;
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it("paces distinct requests when the weighted minute budget is exhausted", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response([]));
    const client = new HyperliquidInfoClient(fetcher);
    // Seven full fills pages reserve 840 weight. Another must wait.
    await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        client.request(
          { type: "userFillsByTime", user: `wallet-${index}` },
          "fills",
        ),
      ),
    );
    const pending = client.request(
      { type: "userFillsByTime", user: "wallet-next" },
      "fills",
    );
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetcher).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("shares concurrent market discovery and reuses all four catalogs for 15 minutes", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response({ universe: [] }));
    await Promise.all([
      fetchHyperliquidMarkets(fetcher),
      fetchHyperliquidMarkets(fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(14 * 60_000);
    await fetchHyperliquidMarkets(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(60_000);
    await fetchHyperliquidMarkets(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("reuses candle windows despite changing request timestamps and refreshes after 15 seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response([]));
    const params = { coin: "io:OAI", interval: "15m" as const, days: 31 };
    await fetchHyperliquidCandles(params, fetcher);
    vi.advanceTimersByTime(5_000);
    await fetchHyperliquidCandles(params, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await fetchHyperliquidCandles({ ...params, interval: "1h" }, fetcher);
    await fetchHyperliquidCandles({ ...params, coin: "BTC" }, fetcher);
    await fetchHyperliquidCandles({ ...params, days: 1 }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(10_000);
    await fetchHyperliquidCandles(params, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("shares positions only for the same wallet and venue", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response({ assetPositions: [] }));
    const client = new HyperliquidInfoClient(fetcher);
    const body = { type: "clearinghouseState", user: "wallet-a", dex: "io" };
    await Promise.all([
      client.request(body, "positions"),
      client.request(body, "positions"),
    ]);
    await client.request(body, "positions");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.request({ ...body, user: "wallet-b" }, "positions");
    await client.request({ ...body, dex: "xyz" }, "positions");
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15_000);
    await client.request(body, "positions");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses a bounded stale catalog during a 429 and blocks further uncached requests until Retry-After", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ universe: ["market"] }))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
      )
      .mockResolvedValueOnce(response({ universe: ["new-market"] }));
    const client = new HyperliquidInfoClient(fetcher);
    const catalog = { type: "spotMeta" };
    await client.request(catalog, "markets");
    vi.advanceTimersByTime(15 * 60_000);
    await expect(client.request(catalog, "markets")).resolves.toEqual({
      universe: ["market"],
    });
    await expect(client.request(catalog, "markets")).resolves.toEqual({
      universe: ["market"],
    });
    await expect(
      client.request({ type: "meta", dex: "io" }, "markets"),
    ).rejects.toThrow("rate limited");
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(119_000);
    await expect(client.request({ type: "meta" }, "markets")).rejects.toThrow(
      "rate limited",
    );
    vi.advanceTimersByTime(1000);
    await expect(client.request(catalog, "markets")).resolves.toEqual({
      universe: ["new-market"],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, "invalid", "http-date"])(
    "backs off on a cold-cache 429 with Retry-After %s",
    async (header) => {
      vi.useFakeTimers();
      const retryAfter =
        header === "http-date"
          ? new Date(Date.now() + 120_000).toUTCString()
          : header;
      const fetcher = vi.fn(
        async () =>
          new Response(null, {
            status: 429,
            headers: retryAfter ? { "Retry-After": retryAfter } : {},
          }),
      );
      const client = new HyperliquidInfoClient(fetcher);
      await expect(
        client.request({ type: "spotMeta" }, "markets"),
      ).rejects.toThrow("HTTP 429");
      vi.advanceTimersByTime(header === "http-date" ? 90_000 : 30_000);
      await expect(client.request({ type: "meta" }, "markets")).rejects.toThrow(
        "rate limited",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("never serves expired positions or catalogs older than 24 hours", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response({}));
    const client = new HyperliquidInfoClient(fetcher);
    await client.request({ type: "spotMeta" }, "markets");
    await client.request(
      { type: "clearinghouseState", user: "wallet" },
      "positions",
    );
    vi.advanceTimersByTime(24 * 60 * 60_000);
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    await expect(
      client.request({ type: "spotMeta" }, "markets"),
    ).rejects.toThrow("HTTP 503");
    await expect(
      client.request(
        { type: "clearinghouseState", user: "wallet" },
        "positions",
      ),
    ).rejects.toThrow("HTTP 503");
  });

  it("clears failed in-flight requests so a subsequent call can recover", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(response({ universe: [] }));
    const client = new HyperliquidInfoClient(fetcher);
    const body = { type: "spotMeta" };
    const results = await Promise.allSettled([
      client.request(body, "markets"),
      client.request(body, "markets"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client.request(body, "markets")).resolves.toEqual({
      universe: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps live history cutoffs stable within each 15-second window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(getHyperliquidSnapshotTime()).toBe(990_000);
    vi.advanceTimersByTime(4_999);
    expect(getHyperliquidSnapshotTime()).toBe(990_000);
    vi.advanceTimersByTime(1);
    expect(getHyperliquidSnapshotTime()).toBe(1_005_000);
  });
});
