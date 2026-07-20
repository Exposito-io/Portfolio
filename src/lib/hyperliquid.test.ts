import { describe, expect, it, vi } from "vitest";

import { fetchHyperliquidAccount } from "@/lib/hyperliquid";
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
          type: "clearinghouseState",
          user: account.address,
          dex: "xyz",
        }),
      }),
    );
    expect(result.summary.netWorthUsd).toBe(4000.42);
    expect(result.summary.totalInvestmentsUsd).toBe(8000.42);
    expect(result.positions).toHaveLength(4);
    expect(result.positions[1]).toMatchObject({
      symbol: "SOL",
      valueUsd: 2500,
      quantity: 12,
    });
    expect(result.positions[3]).toMatchObject({
      symbol: "xyz:XYZ100",
      name: "xyz:XYZ100 Trade XYZ perpetual position",
      valueUsd: 5000,
      quantity: 2,
    });
  });
});
